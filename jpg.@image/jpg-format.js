/* ══════════════════════════════════════════════════════════════════════════
   jpg-format.js — кодек JPEG ⇄ Universal Image Buffer

     jpg(bytes, space = 'rgba')  →  UIB
     jpg.from(uib)               →  Uint8Array (baseline JPEG)

   ДЕКОДЕР — полный:
     · строгий обход маркеров, остановка на EOI (rarjpeg не ломает разбор;
       хвост доступен через jpg.trailer)
     · энтропийные слои: Хаффман и арифметика (QM-кодер, T.81 Annex D)
     · типы кадров: SOF0/1 sequential, SOF2 progressive, SOF3 lossless
       и их арифметические двойники SOF9/10/11
     · иерархический режим (SOF5-7/13-15) НЕ реализован — отвергается
       внятной ошибкой, а не молча разбирается неверно
     · точность 8/12/16 бит, произвольные sampling factors
     · DRI/RSTn с ресинхронизацией, DNL, несколько сканов
     · компоненты: grayscale, YCbCr, RGB, CMYK, YCCK с Adobe APP14 и инверсией
     · EXIF-ориентация применяется к пикселям и отбрасывается

   ЭНКОДЕР — намеренно примитивен: baseline SOF0, таблица квантования из
   единиц, 4:4:4 без сабсэмплинга, стандартные таблицы Хаффмана Annex K,
   один скан, без restart-маркеров. Ручек нет. Остаточная потеря ±1 LSB —
   свойство DCT, а не настроек.

   UIB-ядро и 8×8 DCT импортируются из общих модулей
   (image/buffer-helper.js, algorithm/dct8.js). Самодостаточен не этот
   файл, а его артефакт: сборка инлайнит импорты в один файл.
   ══════════════════════════════════════════════════════════════════════════ */

import {
  UIB_RGBA, UIB_NAMES, UIB_MAX,
  uibSpaceId, uibCreate, uibRead, uibDepthTable, uibConvert, uibToImageData
} from '../image/buffer-helper.js';
import { dct8, idct8 } from '../algorithm/dct8.js';


/* ══ таблицы ═══════════════════════════════════════════════════════════════ */

const ZIGZAG = new Int32Array([
   0,  1,  8, 16,  9,  2,  3, 10, 17, 24, 32, 25, 18, 11,  4,  5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13,  6,  7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
]);


/* T.81 Table D.3 — состояния QM-кодера: Qe, NMPS, NLPS, SWITCH */
const QM = [
  [0x5A1D,  1,  1, 1], [0x2586, 14,  2, 0], [0x1114, 16,  3, 0], [0x080B, 18,  4, 0],
  [0x03D8, 20,  5, 0], [0x01DA, 23,  6, 0], [0x00E5, 25,  7, 0], [0x006F, 28,  8, 0],
  [0x0036, 30,  9, 0], [0x001A, 33, 10, 0], [0x000D, 35, 11, 0], [0x0006,  9, 12, 0],
  [0x0003, 10, 13, 0], [0x0001, 12, 13, 0], [0x5A7F, 15, 15, 1], [0x3F25, 36, 16, 0],
  [0x2CF2, 38, 17, 0], [0x207C, 39, 18, 0], [0x17B9, 40, 19, 0], [0x1182, 42, 20, 0],
  [0x0CEF, 43, 21, 0], [0x09A1, 45, 22, 0], [0x072F, 46, 23, 0], [0x055C, 48, 24, 0],
  [0x0406, 49, 25, 0], [0x0303, 51, 26, 0], [0x0240, 52, 27, 0], [0x01B1, 54, 28, 0],
  [0x0144, 56, 29, 0], [0x00F5, 57, 30, 0], [0x00B7, 59, 31, 0], [0x008A, 60, 32, 0],
  [0x0068, 62, 33, 0], [0x004E, 63, 34, 0], [0x003B, 32, 35, 0], [0x002C, 33,  9, 0],
  [0x5AE1, 37, 37, 1], [0x484C, 64, 38, 0], [0x3A0D, 65, 39, 0], [0x2EF1, 67, 40, 0],
  [0x261F, 68, 41, 0], [0x1F33, 69, 42, 0], [0x19A8, 70, 43, 0], [0x1518, 72, 44, 0],
  [0x1177, 73, 45, 0], [0x0E74, 74, 46, 0], [0x0BFB, 75, 47, 0], [0x09F8, 77, 48, 0],
  [0x0861, 78, 49, 0], [0x0706, 79, 50, 0], [0x05CD, 48, 51, 0], [0x04DE, 50, 52, 0],
  [0x040F, 50, 53, 0], [0x0363, 51, 54, 0], [0x02D4, 52, 55, 0], [0x025C, 53, 56, 0],
  [0x01F8, 54, 57, 0], [0x01A4, 55, 58, 0], [0x0160, 56, 59, 0], [0x0125, 57, 60, 0],
  [0x00F6, 58, 61, 0], [0x00CB, 59, 62, 0], [0x00AB, 61, 63, 0], [0x008F, 61, 32, 0],
  [0x5B12, 65, 65, 1], [0x4D04, 80, 66, 0], [0x412C, 81, 67, 0], [0x37D8, 82, 68, 0],
  [0x2FE8, 83, 69, 0], [0x293C, 84, 70, 0], [0x2379, 86, 71, 0], [0x1EDF, 87, 72, 0],
  [0x1AA9, 87, 73, 0], [0x174E, 72, 74, 0], [0x1424, 72, 75, 0], [0x119C, 74, 76, 0],
  [0x0F6B, 74, 77, 0], [0x0D51, 75, 78, 0], [0x0BB6, 77, 79, 0], [0x0A40, 77, 48, 0],
  [0x5832, 80, 81, 1], [0x4D1C, 88, 82, 0], [0x438E, 89, 83, 0], [0x3BDD, 90, 84, 0],
  [0x34EE, 91, 85, 0], [0x2EAE, 92, 86, 0], [0x299A, 93, 87, 0], [0x2516, 86, 71, 0],
  [0x5570, 88, 89, 1], [0x4CA9, 95, 90, 0], [0x44D9, 96, 91, 0], [0x3E22, 97, 92, 0],
  [0x3824, 99, 93, 0], [0x32B4, 99, 94, 0], [0x2E17, 93, 86, 0], [0x56A8, 95, 96, 1],
  [0x4F46,101, 97, 0], [0x47E5,102, 98, 0], [0x41CF,103, 99, 0], [0x3C3D,104,100, 0],
  [0x375E, 99, 93, 0], [0x5231,105,102, 0], [0x4C0F,106,103, 0], [0x4639,107,104, 0],
  [0x415E,103, 99, 0], [0x5627,105,106, 1], [0x50E7,108,107, 0], [0x4B85,109,103, 0],
  [0x5597,110,109, 0], [0x504F,111,107, 0], [0x5A10,110,111, 1], [0x5522,112,109, 0],
  [0x59EB,112,111, 1]
];
const QM_QE = Int32Array.from(QM, r => r[0]);
const QM_NMPS = Int32Array.from(QM, r => r[1]);
const QM_NLPS = Int32Array.from(QM, r => r[2]);
const QM_SW = Int32Array.from(QM, r => r[3]);


/* ══ побитовое чтение энтропийного потока (Хаффман) ════════════════════════
   Снимает стаффинг FF00, распознаёт RSTn и любой иной маркер как конец
   сегмента, за границу сегмента не выходит.                             ══ */

class BitMSB {
  constructor(data, p, end) {
    this.d = data; this.p = p; this.end = end;
    this.b = 0; this.n = 0; this.marker = 0; this.eof = false;
  }
  fill() {
    if (this.p >= this.end) { this.eof = true; this.b = 0; this.n = 8; return; }
    let v = this.d[this.p++];
    if (v === 0xFF) {
      const nxt = this.p < this.end ? this.d[this.p] : 0xD9;
      if (nxt === 0x00) this.p++;                        // стаффинг: данные 0xFF
      else { this.marker = nxt; this.eof = true; this.p--; v = 0; }
    }
    this.b = v; this.n = 8;
  }
  bit() {
    if (this.n === 0) this.fill();
    this.n--;
    return (this.b >> this.n) & 1;
  }
  bits(k) {
    let v = 0;
    for (let i = 0; i < k; i++) v = (v << 1) | this.bit();
    return v;
  }
  /* к следующему маркеру: сброс битового остатка и поиск FFxx */
  sync() {
    this.b = 0; this.n = 0; this.eof = false; this.marker = 0;
    while (this.p < this.end - 1) {
      if (this.d[this.p] === 0xFF && this.d[this.p + 1] !== 0x00) {
        this.marker = this.d[this.p + 1];
        return this.marker;
      }
      this.p++;
    }
    this.p = this.end;
    return 0;
  }
}

function extend(v, t) { return v < (1 << (t - 1)) ? v - (1 << t) + 1 : v; }

/* Хаффман: mincode/maxcode/valptr — компактно, без таблиц поиска */
function buildHuff(counts, values) {
  const mincode = new Int32Array(17), maxcode = new Int32Array(17), valptr = new Int32Array(17);
  let code = 0, k = 0;
  for (let l = 1; l <= 16; l++) {
    valptr[l] = k;
    mincode[l] = code;
    code += counts[l - 1];
    k += counts[l - 1];
    maxcode[l] = counts[l - 1] === 0 ? -1 : code - 1;
    code <<= 1;
  }
  return { mincode, maxcode, valptr, values };
}

function decodeHuff(br, h) {
  let code = br.bit(), l = 1;
  while (l <= 16) {
    if (h.maxcode[l] >= 0 && code <= h.maxcode[l]) {
      const i = h.valptr[l] + code - h.mincode[l];
      if (i >= h.values.length) throw new Error('JPEG: код Хаффмана вне таблицы');
      return h.values[i];
    }
    code = (code << 1) | br.bit();
    l++;
  }
  throw new Error('JPEG: некорректный код Хаффмана');
}


/* ══ арифметический декодер (T.81 Annex D) ═════════════════════════════════
   Контекст — один байт: старший бит MPS, младшие семь — индекс состояния. ══ */

class Arith {
  constructor(data, p, end) {
    this.d = data; this.p = p; this.end = end; this.marker = 0;
    this.c = 0; this.a = 0; this.ct = 0;
    this.reset();
  }
  /* очередной байт со снятым стаффингом; после маркера отдаёт 0xFF навсегда */
  next() {
    if (this.marker) return 0xFF;
    if (this.p >= this.end) { this.marker = 0xD9; return 0xFF; }
    const v = this.d[this.p];
    if (v === 0xFF) {
      const nxt = this.p + 1 < this.end ? this.d[this.p + 1] : 0xD9;
      if (nxt === 0x00) { this.p += 2; return 0xFF; }
      this.marker = nxt;
      return 0xFF;
    }
    this.p++;
    return v;
  }
  byteIn() {
    this.c = (this.c + (this.next() << 8)) % 0x100000000;
    this.ct = 8;
  }
  reset() {
    this.c = this.next() << 16;
    this.byteIn();
    this.c = (this.c * 128) % 0x100000000;
    this.ct -= 7;
    this.a = 0x8000;
  }
  renorm() {
    do {
      if (this.ct === 0) this.byteIn();
      this.a = (this.a << 1) & 0xFFFF;
      this.c = (this.c * 2) % 0x100000000;
      this.ct--;
    } while ((this.a & 0x8000) === 0);
  }
  decode(st, i) {
    const sv = st[i];
    const icx = sv & 0x7F;
    let mps = sv >> 7;
    const qe = QM_QE[icx];
    this.a -= qe;
    let d;
    if (Math.floor(this.c / 65536) < qe) {
      if (this.a < qe) { d = mps; st[i] = (mps << 7) | QM_NMPS[icx]; }
      else { d = 1 - mps; if (QM_SW[icx]) mps = 1 - mps; st[i] = (mps << 7) | QM_NLPS[icx]; }
      this.a = qe;
      this.renorm();
    } else {
      this.c -= qe * 65536;
      if ((this.a & 0x8000) === 0) {
        if (this.a < qe) { d = 1 - mps; if (QM_SW[icx]) mps = 1 - mps; st[i] = (mps << 7) | QM_NLPS[icx]; }
        else { d = mps; st[i] = (mps << 7) | QM_NMPS[icx]; }
        this.renorm();
      } else d = mps;
    }
    return d;
  }
  sync() {
    this.marker = 0;
    while (this.p < this.end - 1) {
      if (this.d[this.p] === 0xFF && this.d[this.p + 1] !== 0x00) {
        this.marker = this.d[this.p + 1];
        return this.marker;
      }
      this.p++;
    }
    this.p = this.end;
    return 0;
  }
}

/* ══ подготовка компонент кадра ════════════════════════════════════════════ */

function prepareComponents(frame) {
  frame.mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / frame.maxH);
  frame.mcusPerColumn = Math.ceil(frame.scanLines / 8 / frame.maxV);

  for (const c of frame.components) {
    c.blocksPerLine = Math.ceil(Math.ceil(frame.samplesPerLine / 8) * c.h / frame.maxH);
    c.blocksPerColumn = Math.ceil(Math.ceil(frame.scanLines / 8) * c.v / frame.maxV);
    c.blocksPerLineForMcu = frame.mcusPerLine * c.h;
    c.blocksPerColumnForMcu = frame.mcusPerColumn * c.v;
    if (!frame.lossless)
      c.blockData = new Int32Array(c.blocksPerColumnForMcu * 64 * (c.blocksPerLineForMcu + 1));
  }
}

/* Плоскости для lossless: сэмплы, а не блоки */
function prepareLossless(frame) {
  for (const c of frame.components) {
    c.planeW = Math.ceil(frame.samplesPerLine * c.h / frame.maxH);
    c.planeH = Math.ceil(frame.scanLines * c.v / frame.maxV);
    c.mcuW = Math.ceil(frame.samplesPerLine / frame.maxH);
    c.mcuH = Math.ceil(frame.scanLines / frame.maxV);
    c.plane = new Int32Array(c.planeW * c.planeH);
  }
  frame.mcusPerLine = Math.ceil(frame.samplesPerLine / frame.maxH);
  frame.mcusPerColumn = Math.ceil(frame.scanLines / frame.maxV);
}

function blockOffset(c, row, col) {
  return 64 * ((c.blocksPerLineForMcu + 1) * row + col);
}

/* Общий обход MCU скана. cb(component, blockOffset) для каждого блока. */
function walkMcus(frame, comps, resetInterval, cb, onInterval) {
  const single = comps.length === 1;
  const expected = single
    ? comps[0].blocksPerLine * comps[0].blocksPerColumn
    : frame.mcusPerLine * frame.mcusPerColumn;
  const ri = resetInterval || expected;

  let mcu = 0;
  while (mcu < expected) {
    const stop = Math.min(expected, mcu + ri);
    for (; mcu < stop; mcu++) {
      if (single) {
        const c = comps[0];
        cb(c, blockOffset(c, (mcu / c.blocksPerLine) | 0, mcu % c.blocksPerLine));
      } else {
        const mr = (mcu / frame.mcusPerLine) | 0, mc = mcu % frame.mcusPerLine;
        for (const c of comps)
          for (let j = 0; j < c.v; j++)
            for (let k = 0; k < c.h; k++)
              cb(c, blockOffset(c, mr * c.v + j, mc * c.h + k));
      }
    }
    if (mcu < expected) { if (onInterval() === false) return; }
  }
  onInterval();
}


/* ══ скан: энтропия Хаффмана ═══════════════════════════════════════════════ */

function decodeScanHuffman(data, offset, end, frame, comps, resetInterval, Ss, Se, Ah, Al) {
  const br = new BitMSB(data, offset, end);
  const progressive = frame.progressive;
  let eobrun = 0, acState = 0, acNext = 0;

  const receive = n => br.bits(n);
  const receiveExtend = n => (n === 0 ? 0 : extend(br.bits(n), n));

  function baseline(c, off) {
    const t = decodeHuff(br, c.huffDC);
    c.pred += t === 0 ? 0 : receiveExtend(t);
    c.blockData[off] = c.pred;
    let k = 1;
    while (k < 64) {
      const rs = decodeHuff(br, c.huffAC);
      const s = rs & 15, r = rs >> 4;
      if (s === 0) { if (r < 15) break; k += 16; continue; }
      k += r;
      if (k > 63) break;
      c.blockData[off + ZIGZAG[k]] = receiveExtend(s);
      k++;
    }
  }

  function dcFirst(c, off) {
    const t = decodeHuff(br, c.huffDC);
    c.pred += t === 0 ? 0 : receiveExtend(t);
    c.blockData[off] = c.pred << Al;
  }

  function dcRefine(c, off) {
    if (br.bit()) c.blockData[off] |= (1 << Al);
  }

  function acFirst(c, off) {
    if (eobrun > 0) { eobrun--; return; }
    let k = Ss;
    while (k <= Se) {
      const rs = decodeHuff(br, c.huffAC);
      const s = rs & 15, r = rs >> 4;
      if (s === 0) {
        if (r < 15) { eobrun = receive(r) + (1 << r) - 1; break; }
        k += 16;
        continue;
      }
      k += r;
      if (k > Se) break;
      c.blockData[off + ZIGZAG[k]] = receiveExtend(s) * (1 << Al);
      k++;
    }
  }

  function acRefine(c, off) {
    let k = Ss, r = 0;
    while (k <= Se) {
      const z = off + ZIGZAG[k];
      const dir = c.blockData[z] < 0 ? -1 : 1;
      switch (acState) {
        case 0: {
          const rs = decodeHuff(br, c.huffAC);
          const s = rs & 15;
          r = rs >> 4;
          if (s === 0) {
            if (r < 15) { eobrun = receive(r) + (1 << r); acState = 4; }
            else { r = 16; acState = 1; }
          } else {
            if (s !== 1) throw new Error('JPEG: некорректная величина в уточняющем скане');
            acNext = receiveExtend(s);
            acState = r ? 2 : 3;
          }
          continue;
        }
        case 1:
        case 2:
          if (c.blockData[z]) c.blockData[z] += dir * (br.bit() << Al);
          else { r--; if (r === 0) acState = acState === 2 ? 3 : 0; }
          break;
        case 3:
          if (c.blockData[z]) c.blockData[z] += dir * (br.bit() << Al);
          else { c.blockData[z] = acNext << Al; acState = 0; }
          break;
        case 4:
          if (c.blockData[z]) c.blockData[z] += dir * (br.bit() << Al);
          break;
      }
      k++;
    }
    if (acState === 4) { eobrun--; if (eobrun === 0) acState = 0; }
  }

  let fn;
  if (!progressive) fn = baseline;
  else if (Ss === 0) fn = Ah === 0 ? dcFirst : dcRefine;
  else fn = Ah === 0 ? acFirst : acRefine;

  for (const c of comps) c.pred = 0;

  walkMcus(frame, comps, resetInterval, fn, () => {
    /* конец интервала: выравнивание, поглощение RSTn, сброс предикторов */
    const m = br.sync();
    if (m >= 0xD0 && m <= 0xD7) br.p += 2;
    else if (m !== 0) return false;                  // упёрлись в настоящий маркер
    for (const c of comps) c.pred = 0;
    eobrun = 0; acState = 0;
    return true;
  });

  br.sync();
  return br.p;
}


/* ══ скан: арифметическая энтропия (T.81 Annex F.1.4 / F.2.4) ══════════════ */

function decodeScanArith(data, offset, end, frame, comps, resetInterval, Ss, Se, Ah, Al) {
  const dec = new Arith(data, offset, end);
  const fixed = new Uint8Array(1);

  for (const c of comps) {
    if (!c.dcStats) c.dcStats = new Uint8Array(64);
    if (!c.acStats) c.acStats = new Uint8Array(256);
    c.dcStats.fill(0); c.acStats.fill(0);
    c.pred = 0; c.dcContext = 0;
  }

  const L = c => (c.arithL === undefined ? 0 : c.arithL);
  const U = c => (c.arithU === undefined ? 1 : c.arithU);
  const K = c => (c.arithK === undefined ? 5 : c.arithK);

  /* Figure F.19-F.24: декодирование величины со знаком */
  function decodeDC(c, off) {
    const st = c.dcStats;
    let base = c.dcContext;
    if (dec.decode(st, base) === 0) { c.dcContext = 0; }
    else {
      const sign = dec.decode(st, base + 1);
      let si = base + 2 + sign;
      let m = dec.decode(st, si);
      if (m !== 0) {
        si = 20;
        while (dec.decode(st, si)) {
          m <<= 1;
          if (m === 0x8000) throw new Error('JPEG: переполнение величины DC');
          si++;
        }
      }
      if (m < (1 << L(c)) >> 1) c.dcContext = 0;
      else if (m > (1 << U(c)) >> 1) c.dcContext = 12 + sign * 4;
      else c.dcContext = 4 + sign * 4;

      let v = m;
      si += 14;
      let mm = m;
      while ((mm >>= 1)) if (dec.decode(st, si)) v |= mm;
      v += 1;
      if (sign) v = -v;
      c.pred += v;
    }
    c.blockData[off] = c.pred << Al;
  }

  function decodeACBlock(c, off) {
    const st = c.acStats;
    for (let k = Ss; k <= Se; k++) {
      let si = 3 * (k - 1);
      if (dec.decode(st, si)) break;                   // EOB
      while (dec.decode(st, si + 1) === 0) {
        si += 3; k++;
        if (k > Se) throw new Error('JPEG: выход за спектральный диапазон');
      }
      const sign = dec.decode(fixed, 0);
      si += 2;
      let m = dec.decode(st, si);
      if (m !== 0) {
        if (dec.decode(st, si)) {
          m <<= 1;
          si = (k <= K(c)) ? 189 : 217;
          while (dec.decode(st, si)) {
            m <<= 1;
            if (m === 0x8000) throw new Error('JPEG: переполнение величины AC');
            si++;
          }
        }
      }
      let v = m;
      si += 14;
      let mm = m;
      while ((mm >>= 1)) if (dec.decode(st, si)) v |= mm;
      v += 1;
      if (sign) v = -v;
      c.blockData[off + ZIGZAG[k]] = v << Al;
    }
  }

  function dcRefine(c, off) {
    if (dec.decode(fixed, 0)) c.blockData[off] |= (1 << Al);
  }

  function acRefine(c, off) {
    const st = c.acStats;
    const p1 = 1 << Al, m1 = -1 << Al;
    let kex = Se;
    for (; kex > 0; kex--) if (c.blockData[off + ZIGZAG[kex]]) break;

    for (let k = Ss; k <= Se; k++) {
      let si = 3 * (k - 1);
      if (k > kex && dec.decode(st, si)) break;
      for (;;) {
        const z = off + ZIGZAG[k];
        if (c.blockData[z]) {
          if (dec.decode(st, si + 2)) c.blockData[z] += c.blockData[z] < 0 ? m1 : p1;
          break;
        }
        if (dec.decode(st, si + 1)) {
          c.blockData[z] = dec.decode(fixed, 0) ? m1 : p1;
          break;
        }
        si += 3; k++;
        if (k > Se) throw new Error('JPEG: выход за спектральный диапазон');
      }
    }
  }

  let fn;
  if (!frame.progressive) fn = (c, off) => { decodeDC(c, off); decodeACBlock(c, off); };
  else if (Ss === 0) fn = Ah === 0 ? decodeDC : dcRefine;
  else fn = Ah === 0 ? decodeACBlock : acRefine;

  /* для baseline-арифметики Ss/Se не заданы — берём весь спектр */
  if (!frame.progressive) { Ss = 1; Se = 63; }

  walkMcus(frame, comps, resetInterval, fn, () => {
    const m = dec.sync();
    if (m >= 0xD0 && m <= 0xD7) {
      dec.p += 2;
      for (const c of comps) {
        c.dcStats.fill(0); c.acStats.fill(0);
        c.pred = 0; c.dcContext = 0;
      }
      fixed[0] = 0;
      dec.marker = 0;
      dec.reset();
      return true;
    }
    return m === 0;
  });

  dec.sync();
  return dec.p;
}


/* ══ скан: lossless predictive (SOF3 / SOF7 / SOF11) ═══════════════════════ */

function decodeScanLossless(data, offset, end, frame, comps, resetInterval, predictor, Pt, arithmetic) {
  const P = frame.precision;
  const start = 1 << (P - Pt - 1);

  const br = arithmetic ? null : new BitMSB(data, offset, end);
  const dec = arithmetic ? new Arith(data, offset, end) : null;

  if (arithmetic) for (const c of comps) {
    if (!c.dcStats) c.dcStats = new Uint8Array(64);
    c.dcStats.fill(0); c.dcContext = 0;
  }

  function diffHuff(c) {
    const t = decodeHuff(br, c.huffDC);
    if (t === 0) return 0;
    if (t === 16) return -32768;
    return extend(br.bits(t), t);
  }

  function diffArith(c) {
    const st = c.dcStats;
    const base = c.dcContext;
    if (dec.decode(st, base) === 0) { c.dcContext = 0; return 0; }
    const sign = dec.decode(st, base + 1);
    let si = base + 2 + sign;
    let m = dec.decode(st, si);
    if (m !== 0) {
      si = 20;
      while (dec.decode(st, si)) { m <<= 1; if (m === 0x8000) throw new Error('JPEG: переполнение lossless'); si++; }
    }
    const Lc = c.arithL === undefined ? 0 : c.arithL;
    const Uc = c.arithU === undefined ? 1 : c.arithU;
    if (m < (1 << Lc) >> 1) c.dcContext = 0;
    else if (m > (1 << Uc) >> 1) c.dcContext = 12 + sign * 4;
    else c.dcContext = 4 + sign * 4;
    let v = m; si += 14;
    let mm = m;
    while ((mm >>= 1)) if (dec.decode(st, si)) v |= mm;
    v += 1;
    return sign ? -v : v;
  }

  const diff = arithmetic ? diffArith : diffHuff;
  const mask = (1 << P) - 1;

  function sample(c, x, y) {
    const w = c.planeW, pl = c.plane;
    const Ra = x > 0 ? pl[y * w + x - 1] : 0;
    const Rb = y > 0 ? pl[(y - 1) * w + x] : 0;
    const Rc = (x > 0 && y > 0) ? pl[(y - 1) * w + x - 1] : 0;

    let px;
    if (y === 0) px = x === 0 ? start : Ra;
    else if (x === 0) px = Rb;
    else switch (predictor) {
      case 1: px = Ra; break;
      case 2: px = Rb; break;
      case 3: px = Rc; break;
      case 4: px = Ra + Rb - Rc; break;
      case 5: px = Ra + ((Rb - Rc) >> 1); break;
      case 6: px = Rb + ((Ra - Rc) >> 1); break;
      case 7: px = (Ra + Rb) >> 1; break;
      default: px = 0;
    }
    pl[y * w + x] = (px + diff(c)) & mask;
  }

  const single = comps.length === 1;
  const expected = single
    ? comps[0].planeW * comps[0].planeH
    : frame.mcusPerLine * frame.mcusPerColumn;
  const ri = resetInterval || expected;

  let mcu = 0;
  while (mcu < expected) {
    const stop = Math.min(expected, mcu + ri);
    for (; mcu < stop; mcu++) {
      if (single) {
        const c = comps[0];
        sample(c, mcu % c.planeW, (mcu / c.planeW) | 0);
      } else {
        const mr = (mcu / frame.mcusPerLine) | 0, mc = mcu % frame.mcusPerLine;
        for (const c of comps)
          for (let j = 0; j < c.v; j++)
            for (let k = 0; k < c.h; k++) {
              const x = mc * c.h + k, y = mr * c.v + j;
              if (x < c.planeW && y < c.planeH) sample(c, x, y);
            }
      }
    }
    if (mcu < expected) {
      const m = arithmetic ? dec.sync() : br.sync();
      if (m >= 0xD0 && m <= 0xD7) {
        if (arithmetic) {
          dec.p += 2;
          for (const c of comps) { c.dcStats.fill(0); c.dcContext = 0; }
          dec.marker = 0; dec.reset();
        } else br.p += 2;
      } else break;
    }
  }

  if (arithmetic) { dec.sync(); return dec.p; }
  br.sync();
  return br.p;
}


/* ══ обратное DCT ══════════════════════════════════════════════════════════
   Деквантование, округление и клиппинг — здесь; сам 8×8 DCT-II —
   в algorithm/dct8.js.                                                 ══ */

const IDCT_COEF = new Float64Array(64);
const IDCT_OUT = new Float64Array(64);

function idctBlock(coef, off, qt, out, outOff, outStride, shift, maxVal) {
  /* деквантование в естественном порядке */
  const F = IDCT_COEF;
  for (let i = 0; i < 64; i++) F[i] = coef[off + i] * qt[i];

  const s = idct8(F, IDCT_OUT);
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 8; y++) {
      let q = Math.round(s[y * 8 + x]) + shift;
      if (q < 0) q = 0; else if (q > maxVal) q = maxVal;
      out[outOff + y * outStride + x] = q;
    }
}

/* Компонент → плоскость сэмплов размером blocksPerLineForMcu*8 × ... */
function buildPlane(frame, c, qt) {
  const w = c.blocksPerLineForMcu * 8, h = c.blocksPerColumnForMcu * 8;
  const plane = new Int32Array(w * h);
  const shift = 1 << (frame.precision - 1);
  const maxVal = (1 << frame.precision) - 1;

  for (let by = 0; by < c.blocksPerColumnForMcu; by++)
    for (let bx = 0; bx < c.blocksPerLineForMcu; bx++)
      idctBlock(c.blockData, blockOffset(c, by, bx), qt, plane, by * 8 * w + bx * 8, w, shift, maxVal);

  c.planeW = w; c.planeH = h;
  return plane;
}


/* ══ цвет, ориентация, сборка ══════════════════════════════════════════════ */

function orient(px, w, h, o) {
  if (!o || o === 1) return { px, w, h };
  const swap = o >= 5;
  const ow = swap ? h : w, oh = swap ? w : h;
  const out = new Uint16Array(ow * oh * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let nx, ny;
      switch (o) {
        case 2: nx = w - 1 - x; ny = y; break;
        case 3: nx = w - 1 - x; ny = h - 1 - y; break;
        case 4: nx = x; ny = h - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = h - 1 - y; ny = x; break;
        case 7: nx = h - 1 - y; ny = w - 1 - x; break;
        case 8: nx = y; ny = w - 1 - x; break;
        default: nx = x; ny = y;
      }
      const s = (y * w + x) * 4, d = (ny * ow + nx) * 4;
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3];
    }
  return { px: out, w: ow, h: oh };
}

function exifOrientation(app1) {
  if (app1.length < 14) return 1;
  for (let i = 0; i < 4; i++) if (app1[i] !== 'Exif'.charCodeAt(i)) return 1;
  const t = 6;
  const le = app1[t] === 0x49;
  const u16 = p => le ? (app1[p] | (app1[p + 1] << 8)) : ((app1[p] << 8) | app1[p + 1]);
  const u32 = p => le
    ? (app1[p] | (app1[p + 1] << 8) | (app1[p + 2] << 16) | (app1[p + 3] << 24)) >>> 0
    : (((app1[p] << 24) | (app1[p + 1] << 16) | (app1[p + 2] << 8) | app1[p + 3]) >>> 0);
  if (u16(t + 2) !== 42) return 1;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > app1.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > app1.length) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return (v >= 1 && v <= 8) ? v : 1;
    }
  }
  return 1;
}

/* Компонентные плоскости → RGBA u16 полного размера (nearest-апсемплинг) */
function assemble(frame, planes, adobe, maxVal) {
  const W = frame.samplesPerLine, H = frame.scanLines;
  const n = frame.components.length;
  const out = new Uint16Array(W * H * 4);
  const scale = maxVal === UIB_MAX ? null : uibDepthTable(frame.precision);
  const up = v => scale ? scale[v] : v;
  const half = (maxVal + 1) >> 1;

  const get = (ci, x, y) => {
    const c = frame.components[ci], p = planes[ci];
    const sx = Math.min(c.planeW - 1, (x * c.h / frame.maxH) | 0);
    const sy = Math.min(c.planeH - 1, (y * c.v / frame.maxV) | 0);
    return p[sy * c.planeW + sx];
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let r, g, b;

      if (n === 1) {
        r = g = b = get(0, x, y);
      } else if (n === 3) {
        if (frame.colorTransform === 0) { r = get(0, x, y); g = get(1, x, y); b = get(2, x, y); }
        else {
          const Y = get(0, x, y), cb = get(1, x, y) - half, cr = get(2, x, y) - half;
          r = Y + 1.402 * cr;
          g = Y - 0.344136 * cb - 0.714136 * cr;
          b = Y + 1.772 * cb;
        }
      } else {
        let c0, c1, c2;
        const k = get(3, x, y);
        if (frame.colorTransform === 2) {
          const Y = get(0, x, y), cb = get(1, x, y) - half, cr = get(2, x, y) - half;
          c0 = Y + 1.402 * cr;
          c1 = Y - 0.344136 * cb - 0.714136 * cr;
          c2 = Y + 1.772 * cb;
        } else { c0 = get(0, x, y); c1 = get(1, x, y); c2 = get(2, x, y); }
        /* Adobe пишет CMYK инвертированным: хранимое значение уже (max − краска) */
        if (!adobe) { c0 = maxVal - c0; c1 = maxVal - c1; c2 = maxVal - c2; }
        r = c0 * k / maxVal; g = c1 * k / maxVal; b = c2 * k / maxVal;
      }

      r = r < 0 ? 0 : r > maxVal ? maxVal : Math.round(r);
      g = g < 0 ? 0 : g > maxVal ? maxVal : Math.round(g);
      b = b < 0 ? 0 : b > maxVal ? maxVal : Math.round(b);

      out[o] = up(r); out[o + 1] = up(g); out[o + 2] = up(b);
      out[o + 3] = UIB_MAX;                            // JPEG альфы не несёт
    }
  }
  return out;
}


/* ══ обход маркеров ════════════════════════════════════════════════════════ */

const DEFAULT_QT = (() => { const q = new Int32Array(64); q.fill(1); return q; })();

function jpg(bytes, space) {
  if (!(bytes instanceof Uint8Array)) throw new Error('JPEG: ожидался Uint8Array');
  const to = uibSpaceId(space === undefined ? 'rgba' : space);
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('JPEG: нет маркера SOI');

  const quant = [];                                     // таблицы квантования
  const huffDC = [], huffAC = [];
  const arithDC = [], arithAC = [];
  let resetInterval = 0, adobe = false, colorTransform = -1, orientation = 1;
  let frame = null, hierarchical = null, reference = null;
  let p = 2, trailer = null;

  const u16 = q => (bytes[q] << 8) | bytes[q + 1];

  outer:
  while (p < bytes.length) {
    if (bytes[p] !== 0xFF) { p++; continue; }            // мусор между сегментами
    let m = bytes[p + 1];
    while (m === 0xFF) { p++; m = bytes[p + 1]; }        // заполняющие FF
    p += 2;

    if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) continue;   // TEM, отдельные RSTn
    if (m === 0xD9) { trailer = p < bytes.length ? bytes.subarray(p) : null; break; }
    if (m === 0xD8) continue;

    if (p + 2 > bytes.length) break;
    const len = u16(p);
    if (len < 2 || p + len > bytes.length) throw new Error('JPEG: сегмент выходит за границы файла');
    const dp = p + 2, dend = p + len;

    switch (m) {
      case 0xE0: break;                                  // JFIF — плотность не нужна
      case 0xE1: orientation = exifOrientation(bytes.subarray(dp, dend)); break;
      case 0xEE: {                                       // Adobe APP14
        if (len >= 13 && bytes[dp] === 0x41 && bytes[dp + 1] === 0x64 &&
            bytes[dp + 2] === 0x6F && bytes[dp + 3] === 0x62 && bytes[dp + 4] === 0x65) {
          adobe = true;
          colorTransform = bytes[dp + 11];
        }
        break;
      }

      case 0xDB: {                                       // DQT
        let q = dp;
        while (q < dend) {
          const pq = bytes[q] >> 4, tq = bytes[q] & 15;
          q++;
          const tbl = new Int32Array(64);
          for (let i = 0; i < 64; i++) {
            const z = ZIGZAG[i];
            tbl[z] = pq ? ((bytes[q] << 8) | bytes[q + 1]) : bytes[q];
            q += pq ? 2 : 1;
          }
          quant[tq] = tbl;
        }
        break;
      }

      case 0xC4: {                                       // DHT
        let q = dp;
        while (q < dend) {
          const tc = bytes[q] >> 4, th = bytes[q] & 15;
          q++;
          const counts = new Int32Array(16);
          let total = 0;
          for (let i = 0; i < 16; i++) { counts[i] = bytes[q + i]; total += counts[i]; }
          q += 16;
          const values = bytes.subarray(q, q + total);
          q += total;
          (tc === 0 ? huffDC : huffAC)[th] = buildHuff(counts, values);
        }
        break;
      }

      case 0xCC: {                                       // DAC
        let q = dp;
        while (q < dend) {
          const tc = bytes[q] >> 4, tb = bytes[q] & 15;
          const cs = bytes[q + 1];
          q += 2;
          if (tc === 0) arithDC[tb] = { L: cs & 15, U: cs >> 4 };
          else arithAC[tb] = { K: cs };
        }
        break;
      }

      case 0xDD: resetInterval = u16(dp); break;         // DRI
      case 0xDE: hierarchical = { P: bytes[dp], H: u16(dp + 3), W: u16(dp + 1) }; break;  // DHP
      case 0xDF: break;                                  // EXP — учитывается ниже

      case 0xC0: case 0xC1: case 0xC2: case 0xC3:
      case 0xC5: case 0xC6: case 0xC7:
      case 0xC9: case 0xCA: case 0xCB:
      case 0xCD: case 0xCE: case 0xCF: {                 // SOFn
        const differential = (m >= 0xC5 && m <= 0xC7) || (m >= 0xCD && m <= 0xCF);
        if (differential || hierarchical)
          throw new Error('JPEG: иерархический режим (SOF5-7/13-15) не поддерживается');

        frame = {
          arithmetic: m >= 0xC9,
          differential,
          progressive: (m === 0xC2 || m === 0xC6 || m === 0xCA || m === 0xCE),
          lossless: (m === 0xC3 || m === 0xC7 || m === 0xCB || m === 0xCF),
          precision: bytes[dp],
          scanLines: u16(dp + 1),
          samplesPerLine: u16(dp + 3),
          components: [], byId: {},
          maxH: 1, maxV: 1, colorTransform
        };
        if (frame.precision < 2 || frame.precision > 16)
          throw new Error('JPEG: недопустимая точность ' + frame.precision);

        /* высота 0 → она придёт маркером DNL после первого скана; читаем её
           заранее прямым поиском, иначе геометрия скана будет неверной */
        if (frame.scanLines === 0) {
          let q = dend;
          while (q < bytes.length - 3) {
            if (bytes[q] === 0xFF && bytes[q + 1] === 0xDC) { frame.scanLines = (bytes[q + 4] << 8) | bytes[q + 5]; break; }
            q++;
          }
          if (frame.scanLines === 0) throw new Error('JPEG: нулевая высота и нет маркера DNL');
        }
        if (frame.samplesPerLine === 0) throw new Error('JPEG: нулевая ширина');

        const n = bytes[dp + 5];
        if (!n) throw new Error('JPEG: кадр без компонент');
        for (let i = 0; i < n; i++) {
          const q = dp + 6 + i * 3;
          const c = {
            id: bytes[q], h: bytes[q + 1] >> 4, v: bytes[q + 1] & 15, quantId: bytes[q + 2],
            pred: 0, dcContext: 0
          };
          if (!c.h || !c.v || c.h > 4 || c.v > 4) throw new Error('JPEG: недопустимый sampling factor');
          frame.maxH = Math.max(frame.maxH, c.h);
          frame.maxV = Math.max(frame.maxV, c.v);
          frame.components.push(c);
          frame.byId[c.id] = c;
        }
        if (frame.lossless) prepareLossless(frame);
        else prepareComponents(frame);
        break;
      }

      case 0xDC: break;                                  // DNL — уже прочитан при SOF

      case 0xDA: {                                       // SOS
        if (!frame) throw new Error('JPEG: SOS до SOF');
        const ns = bytes[dp];
        const comps = [];
        for (let i = 0; i < ns; i++) {
          const q = dp + 1 + i * 2;
          const c = frame.byId[bytes[q]];
          if (!c) throw new Error('JPEG: скан ссылается на неизвестную компоненту');
          const t = bytes[q + 1];
          if (frame.arithmetic) {
            const a = arithDC[t >> 4] || { L: 0, U: 1 };
            c.arithL = a.L; c.arithU = a.U;
            c.arithK = (arithAC[t & 15] || { K: 5 }).K;
          } else {
            c.huffDC = huffDC[t >> 4];
            c.huffAC = huffAC[t & 15];
          }
          comps.push(c);
        }
        const q = dp + 1 + ns * 2;
        const Ss = bytes[q], Se = bytes[q + 1];
        const Ah = bytes[q + 2] >> 4, Al = bytes[q + 2] & 15;

        let next;
        if (frame.lossless)
          next = decodeScanLossless(bytes, dend, bytes.length, frame, comps, resetInterval, Ss || 1, Al, frame.arithmetic);
        else if (frame.arithmetic)
          next = decodeScanArith(bytes, dend, bytes.length, frame, comps, resetInterval, Ss, Se, Ah, Al);
        else
          next = decodeScanHuffman(bytes, dend, bytes.length, frame, comps, resetInterval,
                                   frame.progressive ? Ss : 0, frame.progressive ? Se : 63, Ah, Al);
        p = next;
        continue outer;
      }

      default: break;                                    // COM, APPn, прочее
    }

    p = dend;
  }

  if (!frame) throw new Error('JPEG: в файле нет кадра');

  /* ── плоскости ─────────────────────────────────────────────────────────── */
  const maxVal = (1 << frame.precision) - 1;
  const planes = frame.components.map(c => {
    if (frame.lossless) return c.plane;
    const qt = quant[c.quantId] || DEFAULT_QT;
    return buildPlane(frame, c, qt);
  });

  /* Adobe APP14 может стоять и после SOF — решаем в самом конце.
     Без него трёхкомпонентный кадр считается YCbCr, кроме случая, когда
     идентификаторы компонент буквально 'R','G','B'. */
  const nc = frame.components.length;
  if (nc !== 1 && nc !== 3 && nc !== 4)
    throw new Error('JPEG: ' + nc + ' компонент — не отображается в RGBA');

  frame.colorTransform = colorTransform;
  if (frame.colorTransform < 0) {
    const ids = frame.components.map(c => c.id);
    /* lossless-режим цветового преобразования не определяет — компоненты
       лежат как есть; для DCT-кадров три компоненты по умолчанию YCbCr */
    frame.colorTransform = (nc === 3 && !frame.lossless &&
      !(ids[0] === 0x52 && ids[1] === 0x47 && ids[2] === 0x42)) ? 1 : 0;
  }

  let rgba = assemble(frame, planes, adobe, maxVal);
  const oriented = orient(rgba, frame.samplesPerLine, frame.scanLines, orientation);

  const u = uibCreate(oriented.w, oriented.h, 1, to);
  u.px.set(oriented.px);
  if (to !== UIB_RGBA) uibConvert(u.px, UIB_RGBA, to);

  jpg.trailer = trailer && trailer.length ? trailer : null;
  return u.buf;
}


/* ══ энкодер: baseline, квантование из единиц, 4:4:4 ═══════════════════════ */

const STD_DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const STD_DC_CHR_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const STD_DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const STD_AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7D];
const STD_AC_LUM_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
  0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
  0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
  0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
  0xF9, 0xFA
];
const STD_AC_CHR_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const STD_AC_CHR_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xA1, 0xB1, 0xC1, 0x09, 0x23, 0x33, 0x52, 0xF0,
  0x15, 0x62, 0x72, 0xD1, 0x0A, 0x16, 0x24, 0x34, 0xE1, 0x25, 0xF1, 0x17, 0x18, 0x19, 0x1A, 0x26,
  0x27, 0x28, 0x29, 0x2A, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
  0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3,
  0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA,
  0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
  0xF9, 0xFA
];

/* символ → {code, size}; канонические коды накопительно */
function encodeTable(bits, vals) {
  const t = new Array(256);
  let code = 0, k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < bits[l - 1]; i++) t[vals[k++]] = { code: code++, size: l };
    code <<= 1;
  }
  return t;
}

class BitWriter {
  constructor() { this.out = []; this.acc = 0; this.n = 0; }
  put(code, size) {
    for (let i = size - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      this.n++;
      if (this.n === 8) {
        this.out.push(this.acc & 0xFF);
        if ((this.acc & 0xFF) === 0xFF) this.out.push(0x00);   // стаффинг
        this.acc = 0; this.n = 0;
      }
    }
  }
  flush() {
    while (this.n !== 0) this.put(1, 1);                       // добивка единицами
  }
}

const FDCT_COEF = new Float64Array(64);

function fdct(block) {
  const c = dct8(block, FDCT_COEF);
  const out = new Int32Array(64);
  for (let i = 0; i < 64; i++) out[i] = Math.round(c[i]);
  return out;
}

function magnitude(v) {
  let a = v < 0 ? -v : v, n = 0;
  while (a) { n++; a >>= 1; }
  return n;
}

jpg.from = function (uib) {
  const u = uibRead(uib);
  if (u.width > 65535 || u.height > 65535)
    throw new Error('JPEG: размер не помещается в u16 (' + u.width + '×' + u.height + ')');

  let px = u.px;
  if (u.space !== UIB_RGBA) px = uibConvert(u.px.slice(), u.space, UIB_RGBA);

  const W = u.width, H = u.height;
  const dcL = encodeTable(STD_DC_LUM_BITS, STD_DC_VALS);
  const dcC = encodeTable(STD_DC_CHR_BITS, STD_DC_VALS);
  const acL = encodeTable(STD_AC_LUM_BITS, STD_AC_LUM_VALS);
  const acC = encodeTable(STD_AC_CHR_BITS, STD_AC_CHR_VALS);

  const head = [];
  const seg = (marker, body) => {
    head.push(0xFF, marker);
    if (body) { head.push(((body.length + 2) >> 8) & 0xFF, (body.length + 2) & 0xFF); for (const b of body) head.push(b); }
  };

  head.push(0xFF, 0xD8);                                        // SOI
  seg(0xE0, [0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

  /* DQT: обе таблицы из единиц — квантования фактически нет */
  const ones = new Array(64).fill(1);
  seg(0xDB, [0x00].concat(ones));
  seg(0xDB, [0x01].concat(ones));

  seg(0xC0, [8, (H >> 8) & 0xFF, H & 0xFF, (W >> 8) & 0xFF, W & 0xFF, 3,
             1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);              // SOF0, 4:4:4

  seg(0xC4, [0x00].concat(STD_DC_LUM_BITS, STD_DC_VALS));
  seg(0xC4, [0x10].concat(STD_AC_LUM_BITS, STD_AC_LUM_VALS));
  seg(0xC4, [0x01].concat(STD_DC_CHR_BITS, STD_DC_VALS));
  seg(0xC4, [0x11].concat(STD_AC_CHR_BITS, STD_AC_CHR_VALS));

  seg(0xDA, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);          // SOS

  /* ── YCbCr 4:4:4 ─────────────────────────────────────────────────────── */
  const Y = new Float64Array(W * H), Cb = new Float64Array(W * H), Cr = new Float64Array(W * H);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) {
    const r = px[o] >> 8, g = px[o + 1] >> 8, b = px[o + 2] >> 8;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }

  const bw = new BitWriter();
  const mcuX = Math.ceil(W / 8), mcuY = Math.ceil(H / 8);
  const pred = [0, 0, 0];
  const block = new Float64Array(64);

  const planes = [Y, Cb, Cr];
  const dcT = [dcL, dcC, dcC], acT = [acL, acC, acC];

  for (let by = 0; by < mcuY; by++) {
    for (let bx = 0; bx < mcuX; bx++) {
      for (let ci = 0; ci < 3; ci++) {
        const src = planes[ci];
        for (let y = 0; y < 8; y++) {
          const sy = Math.min(H - 1, by * 8 + y);
          for (let x = 0; x < 8; x++) {
            const sx = Math.min(W - 1, bx * 8 + x);
            block[y * 8 + x] = src[sy * W + sx];
          }
        }
        const co = fdct(block);

        /* DC */
        const diff = co[0] - pred[ci];
        pred[ci] = co[0];
        const s = magnitude(diff);
        const e = dcT[ci][s];
        if (!e) throw new Error('JPEG: величина DC вне стандартной таблицы');
        bw.put(e.code, e.size);
        if (s) bw.put(diff < 0 ? diff + (1 << s) - 1 : diff, s);

        /* AC */
        let run = 0;
        for (let k = 1; k < 64; k++) {
          const v = co[ZIGZAG[k]];
          if (v === 0) { run++; continue; }
          while (run > 15) { const z = acT[ci][0xF0]; bw.put(z.code, z.size); run -= 16; }
          const sz = magnitude(v);
          const ent = acT[ci][(run << 4) | sz];
          if (!ent) throw new Error('JPEG: пара run/size вне стандартной таблицы');
          bw.put(ent.code, ent.size);
          bw.put(v < 0 ? v + (1 << sz) - 1 : v, sz);
          run = 0;
        }
        if (run > 0) { const eob = acT[ci][0x00]; bw.put(eob.code, eob.size); }
      }
    }
  }
  bw.flush();

  const out = new Uint8Array(head.length + bw.out.length + 2);
  out.set(head, 0);
  out.set(bw.out, head.length);
  out[out.length - 2] = 0xFF;
  out[out.length - 1] = 0xD9;                                   // EOI
  return out;
};

/* ══ проверки ══════════════════════════════════════════════════════════════
   check  — magic numbers, три байта, никогда не бросает
   verify — структурная проверка без декодирования; дескриптор одной формы
            всегда, поля заполнены до места поломки. Пиксельный буфер не
            создаётся ни в одном случае.
   Границу назовём прямо: verify не трогает энтропийные данные. Битый поток
   Хаффмана или арифметики она пропустит — это ловится только декодированием.
   ══════════════════════════════════════════════════════════════════════════ */

jpg.check = function (bytes) {
  return bytes instanceof Uint8Array && bytes.length >= 3 &&
         bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
};

/* до ближайшего настоящего маркера: FF00 — стаффинг, FFD0..FFD7 — RSTn */
function skipEntropy(bytes, p) {
  while (p < bytes.length - 1) {
    if (bytes[p] === 0xFF) {
      const n = bytes[p + 1];
      if (n !== 0x00 && !(n >= 0xD0 && n <= 0xD7)) return p;
    }
    p++;
  }
  return bytes.length;
}

const SOF_MODE = {
  0xC0: 'baseline', 0xC1: 'sequential', 0xC2: 'progressive', 0xC3: 'lossless',
  0xC5: 'hierarchical', 0xC6: 'hierarchical', 0xC7: 'hierarchical',
  0xC9: 'sequential', 0xCA: 'progressive', 0xCB: 'lossless',
  0xCD: 'hierarchical', 0xCE: 'hierarchical', 0xCF: 'hierarchical'
};

jpg.verify = function (bytes) {
  const d = {
    ok: false, error: null, format: 'jpeg',
    width: 0, height: 0, frames: 1,
    precision: 0, components: 0,
    mode: null, entropy: null, colorTransform: -1,
    scans: 0, restartInterval: 0, trailer: 0
  };
  const hex = v => '0x' + v.toString(16).toUpperCase().padStart(2, '0');

  try {
    if (!jpg.check(bytes)) throw new Error('нет маркера SOI');

    const quant = [], hdc = [], hac = [];
    let comps = null, lossless = false, progressive = false, arithmetic = false;
    let sawEOI = false, p = 2;
    const u16 = q => (bytes[q] << 8) | bytes[q + 1];

    while (p < bytes.length) {
      if (bytes[p] !== 0xFF) { p++; continue; }
      let m = bytes[p + 1];
      while (m === 0xFF && p + 2 < bytes.length) { p++; m = bytes[p + 1]; }
      p += 2;

      if (m === 0x01 || m === 0xD8 || (m >= 0xD0 && m <= 0xD7)) continue;
      if (m === 0xD9) { sawEOI = true; d.trailer = bytes.length - p; break; }

      if (p + 2 > bytes.length) throw new Error('сегмент ' + hex(m) + ' обрезан');
      const len = u16(p);
      if (len < 2 || p + len > bytes.length)
        throw new Error('сегмент ' + hex(m) + ' выходит за границы файла');
      const dp = p + 2, dend = p + len;

      switch (m) {
        case 0xEE:                                       // Adobe APP14
          if (len >= 13 && bytes[dp] === 0x41 && bytes[dp + 1] === 0x64 &&
              bytes[dp + 2] === 0x6F && bytes[dp + 3] === 0x62 && bytes[dp + 4] === 0x65)
            d.colorTransform = bytes[dp + 11];
          break;

        case 0xDB: {                                     // DQT
          let q = dp;
          while (q < dend) {
            const pq = bytes[q] >> 4, tq = bytes[q] & 15;
            if (pq > 1 || tq > 3) throw new Error('DQT: недопустимый идентификатор таблицы');
            q += 1 + (pq ? 128 : 64);
            if (q > dend) throw new Error('DQT: таблица не помещается в сегмент');
            quant[tq] = true;
          }
          break;
        }

        case 0xC4: {                                     // DHT
          let q = dp;
          while (q < dend) {
            const tc = bytes[q] >> 4, th = bytes[q] & 15;
            if (tc > 1 || th > 3) throw new Error('DHT: недопустимый идентификатор таблицы');
            q++;
            let total = 0;
            for (let i = 0; i < 16; i++) total += bytes[q + i];
            q += 16 + total;
            if (q > dend) throw new Error('DHT: таблица не помещается в сегмент');
            (tc === 0 ? hdc : hac)[th] = true;
          }
          break;
        }

        case 0xDD: d.restartInterval = u16(dp); break;

        case 0xC0: case 0xC1: case 0xC2: case 0xC3:
        case 0xC5: case 0xC6: case 0xC7:
        case 0xC9: case 0xCA: case 0xCB:
        case 0xCD: case 0xCE: case 0xCF: {               // SOFn
          if (comps) throw new Error('второй кадр в файле: иерархический режим не поддерживается');
          d.mode = SOF_MODE[m];
          if (d.mode === 'hierarchical')
            throw new Error('иерархический режим (' + hex(m) + ') не поддерживается');

          arithmetic = m >= 0xC9;
          progressive = (m === 0xC2 || m === 0xCA);
          lossless = (m === 0xC3 || m === 0xCB);
          d.entropy = arithmetic ? 'arithmetic' : 'huffman';
          d.precision = bytes[dp];
          d.height = u16(dp + 1);
          d.width = u16(dp + 3);
          d.components = bytes[dp + 5];

          if (d.precision < 2 || d.precision > 16)
            throw new Error('недопустимая точность ' + d.precision);
          if (!d.components) throw new Error('кадр без компонент');
          if (len < 8 + d.components * 3) throw new Error('SOF: сегмент короче списка компонент');
          if (d.width === 0) throw new Error('нулевая ширина');

          comps = {};
          for (let i = 0; i < d.components; i++) {
            const q = dp + 6 + i * 3;
            const h = bytes[q + 1] >> 4, v = bytes[q + 1] & 15;
            if (!h || !v || h > 4 || v > 4)
              throw new Error('недопустимый sampling factor у компоненты ' + bytes[q]);
            comps[bytes[q]] = bytes[q + 2];
          }
          break;
        }

        case 0xDC: if (d.height === 0) d.height = u16(dp); break;   // DNL

        case 0xDA: {                                     // SOS
          if (!comps) throw new Error('SOS до SOF');
          const ns = bytes[dp];
          if (!ns || len < 6 + ns * 2) throw new Error('SOS: сегмент короче списка компонент');
          const q = dp + 1 + ns * 2;
          const Ss = bytes[q], Ah = bytes[q + 2] >> 4;

          for (let i = 0; i < ns; i++) {
            const id = bytes[dp + 1 + i * 2];
            if (!(id in comps)) throw new Error('скан ссылается на неизвестную компоненту ' + id);
            const t = bytes[dp + 2 + i * 2];

            if (!lossless && !quant[comps[id]])
              throw new Error('компонента ' + id + ' ссылается на необъявленную таблицу квантования ' + comps[id]);

            if (!arithmetic) {
              const needDC = lossless || !progressive || (Ss === 0 && Ah === 0);
              const needAC = !lossless && (!progressive || Ss > 0);
              if (needDC && !hdc[t >> 4])
                throw new Error('скан ссылается на необъявленную таблицу DC ' + (t >> 4));
              if (needAC && !hac[t & 15])
                throw new Error('скан ссылается на необъявленную таблицу AC ' + (t & 15));
            }
          }
          d.scans++;
          p = skipEntropy(bytes, dend);
          continue;
        }
      }
      p = dend;
    }

    if (!comps) throw new Error('в файле нет кадра');
    if (!d.scans) throw new Error('в файле нет ни одного скана');
    if (d.height === 0) throw new Error('нулевая высота и нет маркера DNL');
    if (!sawEOI) throw new Error('нет маркера EOI');
    if (d.components !== 1 && d.components !== 3 && d.components !== 4)
      throw new Error(d.components + ' компонент — не отображается в RGBA');
  } catch (e) {
    d.error = e.message;
    return d;
  }

  d.ok = true;
  return d;
};

jpg.toImageData = uibToImageData;
jpg.space = UIB_NAMES;
jpg.trailer = null;

export default jpg;
export { jpg };

