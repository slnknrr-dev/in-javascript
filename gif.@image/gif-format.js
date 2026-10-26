/* ══════════════════════════════════════════════════════════════════════════
   gif-format.js — кодек GIF ⇄ Universal Image Buffer

     gif(bytes, space = 'rgba')  →  UIB
     gif.from(uib)               →  Uint8Array (GIF89a)

   Декодер полный: GIF87a/89a, глобальные и локальные палитры, LZW,
   чересстрочность, GCE (задержка, прозрачный индекс, disposal 0-3),
   композитинг подпрямоугольников, расширения пропускаются корректно.

   Энкодер намеренно примитивен: фиксированная палитра 6×6×6 плюс прозрачный
   индекс, полнокадровые кадры с disposal=2, LZW без словаря — CLEAR каждые
   254 кода, поэтому размер кода навсегда остаётся девятибитным.

   UIB-ядро и LZW импортируются из общих модулей (image/buffer-helper.js,
   algorithm/lzw.js). Самодостаточен не этот файл, а его артефакт:
   сборка инлайнит импорты в один файл.
   ══════════════════════════════════════════════════════════════════════════ */

import {
  UIB_RGBA, UIB_NAMES, UIB_MAX,
  uibSpaceId, uibCreate, uibRead, uibDelays, uibSetDelays,
  uibConvert, uibToImageData
} from '../image/buffer-helper.js';
import { lzwDecode, lzwEncodeStored } from '../algorithm/lzw.js';

/* ══ разбор GIF ════════════════════════════════════════════════════════════ */

const GIF_INTERLACE = [[0, 8], [4, 8], [2, 4], [1, 2]];

function readSubBlocks(b, p) {
  const parts = [];
  let n = 0;
  for (;;) {
    if (p >= b.length) throw new Error('GIF: подблоки оборваны');
    const size = b[p++];
    if (size === 0) break;
    if (p + size > b.length) throw new Error('GIF: подблок выходит за границы файла');
    parts.push(b.subarray(p, p + size));
    n += size;
    p += size;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const part of parts) { out.set(part, o); o += part.length; }
  return { data: out, next: p };
}

function skipSubBlocks(b, p) {
  for (;;) {
    if (p >= b.length) throw new Error('GIF: подблоки оборваны');
    const size = b[p++];
    if (size === 0) return p;
    p += size;
  }
}

function gif(bytes, space) {
  if (!(bytes instanceof Uint8Array)) throw new Error('GIF: ожидался Uint8Array');
  const to = uibSpaceId(space === undefined ? 'rgba' : space);

  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('GIF: неверная сигнатура');

  const W = bytes[6] | (bytes[7] << 8);
  const H = bytes[8] | (bytes[9] << 8);
  if (!(W > 0 && H > 0)) throw new Error('GIF: нулевая геометрия логического экрана');

  const packed = bytes[10];
  let p = 13;
  let gct = null;
  if (packed & 0x80) {
    const n = 3 << ((packed & 7) + 1);
    gct = bytes.subarray(p, p + n);
    p += n;
  }

  /* ── проход: собираем кадры ───────────────────────────────────────────── */
  const canvas = new Uint16Array(W * H * 4);
  const out = [];            // снимки холста
  const delays = [];
  let gce = null;

  loop:
  while (p < bytes.length) {
    const marker = bytes[p++];

    switch (marker) {
      case 0x3B: break loop;                              // трейлер

      case 0x21: {                                        // расширение
        const label = bytes[p++];
        if (label === 0xF9) {
          const size = bytes[p++];              // всегда 4
          const pk = bytes[p];
          gce = {
            dispose: (pk >> 2) & 7,
            transparent: (pk & 1) ? bytes[p + 3] : -1,
            delay: bytes[p + 1] | (bytes[p + 2] << 8)
          };
          p += size;                            // теперь p на терминаторе
        }
        p = skipSubBlocks(bytes, p);
        break;
      }

      case 0x2C: {                                        // дескриптор изображения
        const fx = bytes[p] | (bytes[p + 1] << 8);
        const fy = bytes[p + 2] | (bytes[p + 3] << 8);
        const fw = bytes[p + 4] | (bytes[p + 5] << 8);
        const fh = bytes[p + 6] | (bytes[p + 7] << 8);
        const ip = bytes[p + 8];
        p += 9;

        let pal = gct;
        if (ip & 0x80) {
          const n = 3 << ((ip & 7) + 1);
          pal = bytes.subarray(p, p + n);
          p += n;
        }
        if (!pal) throw new Error('GIF: нет ни глобальной, ни локальной палитры');
        if (fw === 0 || fh === 0) throw new Error('GIF: нулевой кадр');

        const minCodeSize = bytes[p++];
        const sub = readSubBlocks(bytes, p);
        p = sub.next;

        const idx = lzwDecode(sub.data, minCodeSize, fw * fh);
        const trans = gce ? gce.transparent : -1;
        const dispose = gce ? gce.dispose : 0;

        let saved = null;
        if (dispose === 3) saved = canvas.slice();

        /* растеризация с учётом чересстрочности */
        const rowOf = new Int32Array(fh);
        if (ip & 0x40) {
          let r = 0;
          for (const [start, step] of GIF_INTERLACE)
            for (let y = start; y < fh; y += step) rowOf[r++] = y;
        } else {
          for (let y = 0; y < fh; y++) rowOf[y] = y;
        }

        for (let sy = 0; sy < fh; sy++) {
          const dy = fy + rowOf[sy];
          if (dy < 0 || dy >= H) continue;
          for (let x = 0; x < fw; x++) {
            const dx = fx + x;
            if (dx < 0 || dx >= W) continue;
            const v = idx[sy * fw + x];
            if (v === trans) continue;                    // прозрачно — холст не трогаем
            const o = (dy * W + dx) * 4;
            const q = v * 3;
            canvas[o] = (q < pal.length ? pal[q] : 0) * 257;
            canvas[o + 1] = (q + 1 < pal.length ? pal[q + 1] : 0) * 257;
            canvas[o + 2] = (q + 2 < pal.length ? pal[q + 2] : 0) * 257;
            canvas[o + 3] = UIB_MAX;
          }
        }

        out.push(canvas.slice());
        delays.push((gce ? gce.delay : 0) * 10);

        if (dispose === 2) {
          for (let y = 0; y < fh; y++) {
            const dy = fy + y;
            if (dy < 0 || dy >= H) continue;
            const x0 = Math.max(0, fx), x1 = Math.min(W, fx + fw);
            if (x1 > x0) canvas.fill(0, (dy * W + x0) * 4, (dy * W + x1) * 4);
          }
        } else if (dispose === 3 && saved) canvas.set(saved);

        gce = null;
        break;
      }

      default:
        /* мусор между блоками — редкость, но встречается: пропускаем байт */
        break;
    }
  }

  if (!out.length) throw new Error('GIF: в файле нет ни одного изображения');

  const u = uibCreate(W, H, out.length, to);
  for (let i = 0; i < out.length; i++) u.px.set(out[i], i * u.stride);
  if (out.length > 1) uibSetDelays(u, delays);
  if (to !== UIB_RGBA) uibConvert(u.px, UIB_RGBA, to);
  return u.buf;
}

/* ══ энкодер ═══════════════════════════════════════════════════════════════
   Палитра 6×6×6 = 216 цветов, индекс 216 — прозрачность.
   Кадры полнокадровые, disposal = 2 (очистка в фон), поэтому альфа
   отрабатывает точно и кадры не накапливаются друг на друге.           ══ */

const GIF_LEVELS = [0, 51, 102, 153, 204, 255];
const GIF_TRANSPARENT = 216;

function gifPalette() {
  const pal = new Uint8Array(256 * 3);
  let i = 0;
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) {
        pal[i++] = GIF_LEVELS[r]; pal[i++] = GIF_LEVELS[g]; pal[i++] = GIF_LEVELS[b];
      }
  return pal;
}

function quantize(px, off, count) {
  const idx = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = off + i * 4;
    if (px[o + 3] < 32768) { idx[i] = GIF_TRANSPARENT; continue; }
    const r = Math.round((px[o] >> 8) * 5 / 255);
    const g = Math.round((px[o + 1] >> 8) * 5 / 255);
    const b = Math.round((px[o + 2] >> 8) * 5 / 255);
    idx[i] = r * 36 + g * 6 + b;
  }
  return idx;
}

gif.from = function (uib) {
  const u = uibRead(uib);
  if (u.width > 65535 || u.height > 65535)
    throw new Error('GIF: размер не помещается в u16 (' + u.width + '×' + u.height + ')');

  let px = u.px;
  if (u.space !== UIB_RGBA) px = uibConvert(u.px.slice(), u.space, UIB_RGBA);

  const W = u.width, H = u.height, N = u.frames;
  const delays = uibDelays(u);
  const parts = [];
  const push = a => parts.push(a instanceof Uint8Array ? a : Uint8Array.from(a));

  push([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);                    // GIF89a
  push([W & 0xFF, W >> 8, H & 0xFF, H >> 8, 0xF7, 0, 0]);        // LSD + GCT 256
  push(gifPalette());

  if (N > 1) {
    /* NETSCAPE 2.0, счётчик циклов 0 — бесконечно; иных значений UIB не несёт */
    push([0x21, 0xFF, 0x0B]);
    push([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]);
    push([0x03, 0x01, 0x00, 0x00, 0x00]);
  }

  for (let i = 0; i < N; i++) {
    const cs = Math.min(65535, Math.round((delays ? delays[i] : 0) / 10));
    push([0x21, 0xF9, 0x04, (2 << 2) | 1, cs & 0xFF, cs >> 8, GIF_TRANSPARENT, 0x00]);
    push([0x2C, 0, 0, 0, 0, W & 0xFF, W >> 8, H & 0xFF, H >> 8, 0x00]);

    const { minCodeSize, data } = lzwEncodeStored(quantize(px, i * u.stride, W * H));
    push([minCodeSize]);
    for (let o = 0; o < data.length; o += 255) {
      const n = Math.min(255, data.length - o);
      push([n]);
      push(data.subarray(o, o + n));
    }
    push([0x00]);
  }

  push([0x3B]);

  let total = 0;
  for (const a of parts) total += a.length;
  const outBuf = new Uint8Array(total);
  let o = 0;
  for (const a of parts) { outBuf.set(a, o); o += a.length; }
  return outBuf;
};

/* ══ проверки ══════════════════════════════════════════════════════════════
   check  — сигнатура, шесть байт, никогда не бросает
   verify — обход блоков с контролем цепочек подблоков, без LZW и без
            пиксельного буфера. Дескриптор одной формы всегда, поля
            заполнены до места поломки. Битый LZW-поток не ловится.
   В отличие от декодера, который молча пропускает мусор между блоками,
   verify считает неизвестный блок ошибкой — на то и проверка.
   ══════════════════════════════════════════════════════════════════════════ */

gif.check = function (bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 6) return false;
  const s = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  return s === 'GIF87a' || s === 'GIF89a';
};

gif.verify = function (bytes) {
  const d = {
    ok: false, error: null, format: 'gif', version: null,
    width: 0, height: 0, frames: 0, delays: null,
    globalPalette: false, transparency: false, trailer: 0
  };

  try {
    if (!gif.check(bytes)) throw new Error('неверная сигнатура');
    d.version = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    if (bytes.length < 13) throw new Error('дескриптор логического экрана обрезан');

    d.width = bytes[6] | (bytes[7] << 8);
    d.height = bytes[8] | (bytes[9] << 8);
    if (!(d.width > 0 && d.height > 0)) throw new Error('нулевая геометрия логического экрана');

    const packed = bytes[10];
    let p = 13;
    if (packed & 0x80) {
      d.globalPalette = true;
      p += 3 << ((packed & 7) + 1);
      if (p > bytes.length) throw new Error('глобальная палитра выходит за границы файла');
    }

    /* цепочка подблоков: последовательность [длина][данные], конец — нулевая длина */
    const walk = q => {
      for (;;) {
        if (q >= bytes.length) throw new Error('цепочка подблоков оборвана');
        const n = bytes[q++];
        if (n === 0) return q;
        q += n;
        if (q > bytes.length) throw new Error('подблок выходит за границы файла');
      }
    };

    const delays = [];
    let delay = 0, sawTrailer = false;

    while (p < bytes.length) {
      const marker = bytes[p++];

      if (marker === 0x3B) { sawTrailer = true; break; }

      if (marker === 0x21) {                             // расширение
        if (p >= bytes.length) throw new Error('расширение без метки');
        const label = bytes[p++];
        if (label === 0xF9) {
          if (p >= bytes.length) throw new Error('GCE обрезан');
          if (bytes[p] !== 4) throw new Error('GCE длиной ' + bytes[p] + ' вместо 4');
          if (p + 5 > bytes.length) throw new Error('GCE обрезан');
          if (bytes[p + 1] & 1) d.transparency = true;
          if (((bytes[p + 1] >> 2) & 7) > 3) throw new Error('неизвестный метод утилизации');
          delay = (bytes[p + 2] | (bytes[p + 3] << 8)) * 10;
          p += 5;
        }
        p = walk(p);

      } else if (marker === 0x2C) {                      // дескриптор изображения
        if (p + 9 > bytes.length) throw new Error('дескриптор изображения обрезан');
        const fw = bytes[p + 4] | (bytes[p + 5] << 8);
        const fh = bytes[p + 6] | (bytes[p + 7] << 8);
        const ip = bytes[p + 8];
        p += 9;
        if (fw === 0 || fh === 0) throw new Error('кадр нулевого размера');

        let hasPalette = d.globalPalette;
        if (ip & 0x80) {
          hasPalette = true;
          p += 3 << ((ip & 7) + 1);
          if (p > bytes.length) throw new Error('локальная палитра выходит за границы файла');
        }
        if (!hasPalette) throw new Error('кадр без глобальной и локальной палитры');

        if (p >= bytes.length) throw new Error('нет минимального размера кода LZW');
        const mcs = bytes[p++];
        if (mcs < 2 || mcs > 11) throw new Error('недопустимый минимальный размер кода LZW: ' + mcs);

        p = walk(p);
        delays.push(delay);
        delay = 0;

      } else {
        throw new Error('неизвестный блок 0x' + marker.toString(16).toUpperCase() +
                        ' на смещении ' + (p - 1));
      }
    }

    d.frames = delays.length;
    if (!d.frames) throw new Error('в файле нет ни одного изображения');
    if (d.frames > 1) d.delays = delays;
    if (!sawTrailer) throw new Error('нет трейлера 0x3B');
    d.trailer = bytes.length - p;
  } catch (e) {
    d.error = e.message;
    return d;
  }

  d.ok = true;
  return d;
};

gif.toImageData = uibToImageData;
gif.space = UIB_NAMES;

export default gif;
export { gif };
