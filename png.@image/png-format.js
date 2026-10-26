/* ══════════════════════════════════════════════════════════════════════════
   png-format.js — кодек PNG ⇄ Universal Image Buffer

     png(bytes, space = 'rgba')  →  UIB
     png.from(uib)               →  Uint8Array (PNG/APNG)

   Декодер полный: типы цвета 0/2/3/4/6, глубины 1/2/4/8/16, PLTE, tRNS,
   Adam7, все пять фильтров, собственный inflate, APNG с композитингом
   dispose/blend. Энкодер намеренно примитивен: тип 6, 16 бит, фильтр 0,
   deflate stored-блоками (PNG это позволяет, компрессора нет вовсе).

   UIB-ядро, CRC-32, inflate и stored-deflate импортируются из общих
   модулей (image/buffer-helper.js, algorithm/). Самодостаточен не этот
   файл, а его артефакт: сборка инлайнит импорты в один файл.
   ══════════════════════════════════════════════════════════════════════════ */

import {
  UIB_RGBA, UIB_NAMES, UIB_MAX,
  uibSpaceId, uibCreate, uibRead, uibDelays, uibSetDelays,
  uibDepthTable, uibConvert, uibToImageData
} from '../image/buffer-helper.js';
import { crc32 } from '../algorithm/crc32.js';
import { inflateZlib } from '../algorithm/inflate.js';
import { deflateStored } from '../algorithm/deflate-stored.js';

/* ══ разбор PNG ════════════════════════════════════════════════════════════ */

const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const CHANNELS = [1, 0, 3, 1, 2, 0, 4];      // по типу цвета
const ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
  [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]
];

function be32(b, p) { return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; }
function be16(b, p) { return (b[p] << 8) | b[p + 1]; }

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

/* Снимает фильтры со всех строк подкартинки на месте, возвращает
   плотный массив строк без байта фильтра. */
function unfilter(src, off, rowBytes, rows, bpp) {
  const out = new Uint8Array(rowBytes * rows);
  let sp = off, op = 0, prev = -rowBytes;
  for (let y = 0; y < rows; y++) {
    const f = src[sp++];
    for (let x = 0; x < rowBytes; x++) {
      const raw = src[sp + x];
      const a = x >= bpp ? out[op + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = (y > 0 && x >= bpp) ? out[prev + x - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: v = raw + paeth(a, b, c); break;
        default: throw new Error('PNG: неизвестный фильтр ' + f);
      }
      out[op + x] = v & 0xFF;
    }
    prev = op; op += rowBytes; sp += rowBytes;
  }
  return { rows: out, consumed: sp - off };
}

/* Разворачивает сырые сэмплы строки (упаковка MSB-first для глубин < 8). */
function readRow(row, pw, ch, depth, dst) {
  if (depth === 16) {
    for (let i = 0, p = 0; i < pw * ch; i++, p += 2) dst[i] = (row[p] << 8) | row[p + 1];
  } else if (depth === 8) {
    for (let i = 0; i < pw * ch; i++) dst[i] = row[i];
  } else {
    const mask = (1 << depth) - 1;
    let bit = 0;
    for (let i = 0; i < pw * ch; i++) {
      const byte = row[bit >> 3];
      const shift = 8 - depth - (bit & 7);
      dst[i] = (byte >> shift) & mask;
      bit += depth;
    }
  }
}

/* Подкартинка → RGBA u16 в общий растр с шагом (xs,ys,dx,dy). */
function emitPass(raw, pw, ph, ihdr, plte, trns, out, W, xs, ys, dx, dy) {
  const { depth, ctype } = ihdr;
  const ch = CHANNELS[ctype];
  const rowBytes = Math.ceil(pw * ch * depth / 8);
  const bpp = Math.max(1, (ch * depth) >> 3);
  const { rows, consumed } = unfilter(raw.src, raw.off, rowBytes, ph, bpp);
  raw.off += consumed;

  const scale = depth === 16 ? null : uibDepthTable(depth);
  const samp = new Uint16Array(pw * ch);

  for (let y = 0; y < ph; y++) {
    readRow(rows.subarray(y * rowBytes, (y + 1) * rowBytes), pw, ch, depth, samp);
    const oy = ys + y * dy;
    for (let x = 0; x < pw; x++) {
      const o = ((oy * W) + (xs + x * dx)) * 4;
      const s = x * ch;
      let r, g, b, a = UIB_MAX;

      switch (ctype) {
        case 0: {                                   // серый
          const v = samp[s];
          if (trns && trns.gray === v) a = 0;
          r = g = b = scale ? scale[v] : v;
          break;
        }
        case 2: {                                   // RGB
          const rv = samp[s], gv = samp[s + 1], bv = samp[s + 2];
          if (trns && trns.r === rv && trns.g === gv && trns.b === bv) a = 0;
          r = scale ? scale[rv] : rv;
          g = scale ? scale[gv] : gv;
          b = scale ? scale[bv] : bv;
          break;
        }
        case 3: {                                   // палитра
          const idx = samp[s];
          if (!plte || idx * 3 + 2 >= plte.length) throw new Error('PNG: индекс вне палитры');
          r = plte[idx * 3] * 257;
          g = plte[idx * 3 + 1] * 257;
          b = plte[idx * 3 + 2] * 257;
          a = (trns && trns.alpha && idx < trns.alpha.length) ? trns.alpha[idx] * 257 : UIB_MAX;
          break;
        }
        case 4: {                                   // серый + альфа
          const v = samp[s], av = samp[s + 1];
          r = g = b = scale ? scale[v] : v;
          a = scale ? scale[av] : av;
          break;
        }
        default: {                                  // 6 — RGBA
          r = scale ? scale[samp[s]] : samp[s];
          g = scale ? scale[samp[s + 1]] : samp[s + 1];
          b = scale ? scale[samp[s + 2]] : samp[s + 2];
          a = scale ? scale[samp[s + 3]] : samp[s + 3];
        }
      }

      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
}

/* Полное изображение (или APNG-кадр) → RGBA u16 */
function decodeRaster(inflated, w, h, ihdr, plte, trns) {
  const out = new Uint16Array(w * h * 4);
  const raw = { src: inflated, off: 0 };

  if (!ihdr.interlace) {
    emitPass(raw, w, h, ihdr, plte, trns, out, w, 0, 0, 1, 1);
  } else {
    for (let i = 0; i < 7; i++) {
      const [xs, ys, dx, dy] = ADAM7[i];
      const pw = Math.ceil((w - xs) / dx);
      const ph = Math.ceil((h - ys) / dy);
      if (pw <= 0 || ph <= 0) continue;
      emitPass(raw, pw, ph, ihdr, plte, trns, out, w, xs, ys, dx, dy);
    }
  }
  return out;
}

/* Композитинг APNG-кадра на холст. blend: 0 SOURCE, 1 OVER. */
function blendFrame(canvas, W, src, fw, fh, ox, oy, blend) {
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const si = (y * fw + x) * 4;
      const di = ((oy + y) * W + (ox + x)) * 4;
      if (blend === 0) {
        canvas[di] = src[si]; canvas[di + 1] = src[si + 1];
        canvas[di + 2] = src[si + 2]; canvas[di + 3] = src[si + 3];
      } else {
        const as = src[si + 3] / UIB_MAX;
        if (as >= 1) {
          canvas[di] = src[si]; canvas[di + 1] = src[si + 1];
          canvas[di + 2] = src[si + 2]; canvas[di + 3] = src[si + 3];
        } else if (as > 0) {
          const ad = canvas[di + 3] / UIB_MAX;
          const ao = as + ad * (1 - as);
          if (ao <= 0) { canvas[di] = canvas[di + 1] = canvas[di + 2] = canvas[di + 3] = 0; }
          else {
            for (let c = 0; c < 3; c++)
              canvas[di + c] = Math.round((src[si + c] * as + canvas[di + c] * ad * (1 - as)) / ao);
            canvas[di + 3] = Math.round(ao * UIB_MAX);
          }
        }
      }
    }
  }
}


/* ══ публичный декодер ═════════════════════════════════════════════════════ */

function png(bytes, space) {
  if (!(bytes instanceof Uint8Array)) throw new Error('PNG: ожидался Uint8Array');
  const to = uibSpaceId(space === undefined ? 'rgba' : space);

  for (let i = 0; i < 8; i++)
    if (bytes[i] !== PNG_SIG[i]) throw new Error('PNG: неверная сигнатура');

  let ihdr = null, plte = null, trns = null, acTL = null;
  const idat = [];
  const frames = [];              // {fctl, chunks:[]}
  let cur = null, sawIDAT = false, idatIsFrame = false;

  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = be32(bytes, p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const dp = p + 8;
    if (dp + len + 4 > bytes.length) throw new Error('PNG: чанк ' + type + ' выходит за границы файла');

    const want = be32(bytes, dp + len);
    const got = crc32(bytes, p + 4, dp + len);
    if (want !== got) throw new Error('PNG: CRC чанка ' + type + ' не сходится');

    switch (type) {
      case 'IHDR': {
        ihdr = {
          width: be32(bytes, dp), height: be32(bytes, dp + 4),
          depth: bytes[dp + 8], ctype: bytes[dp + 9],
          compression: bytes[dp + 10], filter: bytes[dp + 11], interlace: bytes[dp + 12]
        };
        if (!(ihdr.width > 0 && ihdr.height > 0)) throw new Error('PNG: нулевая геометрия');
        if (CHANNELS[ihdr.ctype] === 0 && ihdr.ctype !== 0) throw new Error('PNG: неизвестный тип цвета');
        const ok = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[ihdr.ctype];
        if (!ok || ok.indexOf(ihdr.depth) < 0)
          throw new Error('PNG: глубина ' + ihdr.depth + ' недопустима для типа ' + ihdr.ctype);
        if (ihdr.compression !== 0 || ihdr.filter !== 0) throw new Error('PNG: неизвестный метод сжатия/фильтрации');
        if (ihdr.interlace > 1) throw new Error('PNG: неизвестная схема чересстрочности');
        break;
      }
      case 'PLTE': plte = bytes.subarray(dp, dp + len); break;
      case 'tRNS': {
        if (!ihdr) throw new Error('PNG: tRNS до IHDR');
        if (ihdr.ctype === 3) trns = { alpha: bytes.subarray(dp, dp + len) };
        else if (ihdr.ctype === 0) trns = { gray: be16(bytes, dp) };
        else if (ihdr.ctype === 2) trns = { r: be16(bytes, dp), g: be16(bytes, dp + 2), b: be16(bytes, dp + 4) };
        break;
      }
      case 'acTL': acTL = { numFrames: be32(bytes, dp), numPlays: be32(bytes, dp + 4) }; break;
      case 'fcTL': {
        cur = {
          w: be32(bytes, dp + 4), h: be32(bytes, dp + 8),
          x: be32(bytes, dp + 12), y: be32(bytes, dp + 16),
          delayNum: be16(bytes, dp + 20), delayDen: be16(bytes, dp + 22),
          dispose: bytes[dp + 24], blend: bytes[dp + 25],
          chunks: []
        };
        if (!sawIDAT) idatIsFrame = true;
        frames.push(cur);
        break;
      }
      case 'IDAT':
        sawIDAT = true;
        idat.push(bytes.subarray(dp, dp + len));
        if (idatIsFrame && frames.length) frames[0].chunks.push(bytes.subarray(dp, dp + len));
        break;
      case 'fdAT':
        if (!cur) throw new Error('PNG: fdAT без fcTL');
        cur.chunks.push(bytes.subarray(dp + 4, dp + len));   // первые 4 байта — sequence number
        break;
      case 'IEND':
        p = bytes.length;
        break;
    }

    if (type === 'IEND') break;
    p = dp + len + 4;
  }

  if (!ihdr) throw new Error('PNG: нет чанка IHDR');
  if (!idat.length) throw new Error('PNG: нет данных изображения');
  if (ihdr.ctype === 3 && !plte) throw new Error('PNG: палитровое изображение без PLTE');

  const W = ihdr.width, H = ihdr.height;

  /* ── одиночное изображение ─────────────────────────────────────────────── */
  const animated = acTL && frames.length > 0 && idatIsFrame;
  if (!animated) {
    const rgba = decodeRaster(inflateZlib(concat(idat)), W, H, ihdr, plte, trns);
    const u = uibCreate(W, H, 1, to);
    u.px.set(rgba);
    if (to !== UIB_RGBA) uibConvert(u.px, UIB_RGBA, to);
    return u.buf;
  }

  /* ── APNG ─────────────────────────────────────────────────────────────── */
  const n = frames.length;
  const u = uibCreate(W, H, n, to);
  const canvas = new Uint16Array(W * H * 4);
  const delays = new Array(n);

  for (let i = 0; i < n; i++) {
    const f = frames[i];
    if (f.x + f.w > W || f.y + f.h > H) throw new Error('PNG: кадр APNG выходит за холст');

    let saved = null;
    if (f.dispose === 2) saved = canvas.slice();

    const sub = { width: f.w, height: f.h, depth: ihdr.depth, ctype: ihdr.ctype, interlace: ihdr.interlace };
    const rgba = decodeRaster(inflateZlib(concat(f.chunks)), f.w, f.h, sub, plte, trns);
    blendFrame(canvas, W, rgba, f.w, f.h, f.x, f.y, i === 0 ? 0 : f.blend);

    u.px.set(canvas, i * u.stride);
    delays[i] = Math.round(f.delayNum * 1000 / (f.delayDen || 100));

    if (f.dispose === 1) {
      for (let y = 0; y < f.h; y++) {
        const o = ((f.y + y) * W + f.x) * 4;
        canvas.fill(0, o, o + f.w * 4);
      }
    } else if (f.dispose === 2 && saved) canvas.set(saved);
  }

  uibSetDelays(u, delays);
  if (to !== UIB_RGBA) uibConvert(u.px, UIB_RGBA, to);
  return u.buf;
}

function concat(list) {
  let n = 0;
  for (const a of list) n += a.length;
  const out = new Uint8Array(n);
  let p = 0;
  for (const a of list) { out.set(a, p); p += a.length; }
  return out;
}


/* ══ публичный энкодер ═════════════════════════════════════════════════════
   Тип цвета 6, глубина 16, без чересстрочности, фильтр 0, deflate stored.
   Многокадровый UIB пишется как APNG полнокадровыми фрагментами.        ══ */

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  out[0] = (data.length >>> 24) & 0xFF; out[1] = (data.length >>> 16) & 0xFF;
  out[2] = (data.length >>> 8) & 0xFF; out[3] = data.length & 0xFF;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const c = crc32(out, 4, 8 + data.length);
  const p = 8 + data.length;
  out[p] = (c >>> 24) & 0xFF; out[p + 1] = (c >>> 16) & 0xFF;
  out[p + 2] = (c >>> 8) & 0xFF; out[p + 3] = c & 0xFF;
  return out;
}

/* RGBA u16 кадра → строки с байтом фильтра 0 */
function rawScanlines(px, off, w, h) {
  const rowBytes = w * 8;
  const out = new Uint8Array(h * (1 + rowBytes));
  let p = 0;
  for (let y = 0; y < h; y++) {
    out[p++] = 0;
    let s = off + y * w * 4;
    for (let x = 0; x < w * 4; x++, s++) {
      const v = px[s];
      out[p++] = v >> 8; out[p++] = v & 0xFF;
    }
  }
  return out;
}

png.from = function (uib) {
  const u = uibRead(uib);

  /* работаем с копией: буфер вызывающего не трогаем */
  let px = u.px;
  if (u.space !== UIB_RGBA) px = uibConvert(u.px.slice(), u.space, UIB_RGBA);

  const W = u.width, H = u.height, N = u.frames;
  const parts = [new Uint8Array(PNG_SIG)];

  const ihdr = new Uint8Array(13);
  ihdr[0] = (W >>> 24) & 0xFF; ihdr[1] = (W >>> 16) & 0xFF; ihdr[2] = (W >>> 8) & 0xFF; ihdr[3] = W & 0xFF;
  ihdr[4] = (H >>> 24) & 0xFF; ihdr[5] = (H >>> 16) & 0xFF; ihdr[6] = (H >>> 8) & 0xFF; ihdr[7] = H & 0xFF;
  ihdr[8] = 16; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  parts.push(chunk('IHDR', ihdr));

  const delays = uibDelays(u);
  let seq = 0;

  if (N > 1) {
    const a = new Uint8Array(8);
    a[0] = (N >>> 24) & 0xFF; a[1] = (N >>> 16) & 0xFF; a[2] = (N >>> 8) & 0xFF; a[3] = N & 0xFF;
    /* num_plays = 0 — бесконечно; счётчика циклов в UIB нет по построению */
    parts.push(chunk('acTL', a));
  }

  for (let i = 0; i < N; i++) {
    if (N > 1) {
      const ms = delays ? delays[i] : 0;
      const f = new Uint8Array(26);
      const put32 = (o, v) => { f[o] = (v >>> 24) & 0xFF; f[o + 1] = (v >>> 16) & 0xFF; f[o + 2] = (v >>> 8) & 0xFF; f[o + 3] = v & 0xFF; };
      put32(0, seq++); put32(4, W); put32(8, H); put32(12, 0); put32(16, 0);
      /* задержка как ms/1000 — знаменатель фиксирован, числитель влезает в u16 */
      const num = Math.min(65535, ms), den = 1000;
      f[20] = (num >> 8) & 0xFF; f[21] = num & 0xFF;
      f[22] = (den >> 8) & 0xFF; f[23] = den & 0xFF;
      f[24] = 0;   // dispose = NONE
      f[25] = 0;   // blend   = SOURCE
      parts.push(chunk('fcTL', f));
    }

    const z = deflateStored(rawScanlines(px, i * u.stride, W, H));
    if (i === 0) parts.push(chunk('IDAT', z));
    else {
      const fd = new Uint8Array(4 + z.length);
      fd[0] = (seq >>> 24) & 0xFF; fd[1] = (seq >>> 16) & 0xFF;
      fd[2] = (seq >>> 8) & 0xFF; fd[3] = seq & 0xFF;
      seq++;
      fd.set(z, 4);
      parts.push(chunk('fdAT', fd));
    }
  }

  parts.push(chunk('IEND', new Uint8Array(0)));
  return concat(parts);
};

/* ══ проверки ══════════════════════════════════════════════════════════════
   check  — сигнатура, восемь байт, никогда не бросает
   verify — обход чанков с контролем CRC, без inflate и без пиксельного
            буфера. Дескриптор одной формы всегда, поля заполнены до места
            поломки. Целостность сжатых данных не проверяется: битый deflate
            ловится только декодированием.
   ══════════════════════════════════════════════════════════════════════════ */

png.check = function (bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
  return true;
};

png.verify = function (bytes) {
  const d = {
    ok: false, error: null, format: 'png',
    width: 0, height: 0, frames: 1,
    depth: 0, ctype: -1, interlace: 0,
    palette: false, transparency: false,
    chunks: 0, trailer: 0
  };

  try {
    if (!png.check(bytes)) throw new Error('неверная сигнатура');

    let ihdr = false, idat = 0, iend = false;
    let acTL = -1, fcTL = 0;
    let p = 8;

    while (p + 8 <= bytes.length) {
      const len = be32(bytes, p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      if (!/^[A-Za-z]{4}$/.test(type))
        throw new Error('нечитаемый тип чанка на смещении ' + p);

      const dp = p + 8;
      if (dp + len + 4 > bytes.length)
        throw new Error('чанк ' + type + ' выходит за границы файла');
      if (crc32(bytes, p + 4, dp + len) !== be32(bytes, dp + len))
        throw new Error('CRC чанка ' + type + ' не сходится');

      d.chunks++;
      if (!ihdr && type !== 'IHDR') throw new Error('первый чанк не IHDR, а ' + type);

      switch (type) {
        case 'IHDR': {
          if (ihdr) throw new Error('повторный IHDR');
          if (len !== 13) throw new Error('IHDR длиной ' + len + ' вместо 13');
          ihdr = true;
          d.width = be32(bytes, dp);
          d.height = be32(bytes, dp + 4);
          d.depth = bytes[dp + 8];
          d.ctype = bytes[dp + 9];
          d.interlace = bytes[dp + 12];
          if (!(d.width > 0 && d.height > 0)) throw new Error('нулевая геометрия');
          const ok = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[d.ctype];
          if (!ok) throw new Error('неизвестный тип цвета ' + d.ctype);
          if (ok.indexOf(d.depth) < 0)
            throw new Error('глубина ' + d.depth + ' недопустима для типа цвета ' + d.ctype);
          if (bytes[dp + 10] !== 0) throw new Error('неизвестный метод сжатия');
          if (bytes[dp + 11] !== 0) throw new Error('неизвестный метод фильтрации');
          if (d.interlace > 1) throw new Error('неизвестная схема чересстрочности');
          break;
        }
        case 'PLTE':
          if (len === 0 || len % 3) throw new Error('длина PLTE не кратна трём');
          if (len / 3 > 256) throw new Error('в PLTE больше 256 записей');
          if (idat) throw new Error('PLTE после IDAT');
          d.palette = true;
          break;
        case 'tRNS':
          if (idat) throw new Error('tRNS после IDAT');
          d.transparency = true;
          break;
        case 'IDAT': idat++; break;
        case 'acTL':
          if (len !== 8) throw new Error('acTL длиной ' + len + ' вместо 8');
          if (idat) throw new Error('acTL после IDAT');
          acTL = be32(bytes, dp);
          break;
        case 'fcTL': {
          if (len !== 26) throw new Error('fcTL длиной ' + len + ' вместо 26');
          fcTL++;
          const fw = be32(bytes, dp + 4), fh = be32(bytes, dp + 8);
          const fx = be32(bytes, dp + 12), fy = be32(bytes, dp + 16);
          if (fw === 0 || fh === 0) throw new Error('кадр APNG нулевого размера');
          if (fx + fw > d.width || fy + fh > d.height)
            throw new Error('кадр APNG выходит за холст');
          if (bytes[dp + 24] > 2) throw new Error('неизвестный dispose_op ' + bytes[dp + 24]);
          if (bytes[dp + 25] > 1) throw new Error('неизвестный blend_op ' + bytes[dp + 25]);
          break;
        }
        case 'fdAT':
          if (len < 4) throw new Error('fdAT короче номера последовательности');
          break;
        case 'IEND':
          if (len !== 0) throw new Error('IEND ненулевой длины');
          iend = true;
          break;
      }

      p = dp + len + 4;
      if (iend) break;
    }

    if (!ihdr) throw new Error('нет чанка IHDR');
    if (d.ctype === 3 && !d.palette) throw new Error('палитровое изображение без PLTE');
    if (!idat) throw new Error('нет данных изображения');
    if (!iend) throw new Error('нет чанка IEND');
    if (acTL >= 0) {
      if (acTL !== fcTL)
        throw new Error('acTL обещает ' + acTL + ' кадров, а fcTL найдено ' + fcTL);
      if (!fcTL) throw new Error('acTL без единого fcTL');
      d.format = 'apng';
      d.frames = fcTL;
    }
    d.trailer = bytes.length - p;
  } catch (e) {
    d.error = e.message;
    return d;
  }

  d.ok = true;
  return d;
};

png.toImageData = uibToImageData;
png.space = UIB_NAMES;

export default png;
export { png };
