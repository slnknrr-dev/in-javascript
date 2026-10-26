/* ══════════════════════════════════════════════════════════════════════════
   buffer-helper.js — Universal Image Buffer (UIB), ядро v1

   Одна байтовая раскладка, общая для всех графических сниппетов репозитория:
   заголовок, таблица задержек, пиксели uint16 в RGBA/HSVA/HSLA. Благодаря ей
   декодер здесь и энкодер там ничего не знают друг о друге.

   Это helper, а не алгоритм: раскладка осмысленна только в предметной области
   изображений, и существует файл ради того, чтобы быть заинлайненным 1-в-1
   в потребителей. Собственных артефактов не имеет — singlefile-копии
   появляются внутри артефактов png/jpg/gif и эффектов.

   Переносимое за пределы изображений вынесено в algorithm/:
   crc32, adler32, inflate, deflate-stored, lzw, dct8.
   ══════════════════════════════════════════════════════════════════════════ */

const UIB_RGBA = 0, UIB_HSVA = 1, UIB_HSLA = 2;
const UIB_NAMES = ['rgba', 'hsva', 'hsla'];
const UIB_MAX = 65535;

function uibSpaceId(s) {
  if (typeof s === 'number') { if (s >= 0 && s <= 2) return s; throw new Error('UIB: неизвестная схема ' + s); }
  const k = String(s).toLowerCase();
  const i = UIB_NAMES.indexOf(k === 'rgb' ? 'rgba' : k === 'hsv' ? 'hsva' : k === 'hsl' ? 'hsla' : k);
  if (i < 0) throw new Error('UIB: неизвестная схема ' + s);
  return i;
}

function uibBytesFor(v) { return v <= 0xFF ? 1 : v <= 0xFFFF ? 2 : v <= 0xFFFFFFFF ? 4 : 8; }
function uibKof(b) { return b === 1 ? 0 : b === 2 ? 1 : b === 4 ? 2 : 3; }
function uibPow2(n) { return n <= 1 ? 1 : 1 << (32 - Math.clz32(n - 1)); }

function uibPutInt(buf, p, v, n) {
  for (let i = n - 1; i >= 0; i--) { buf[p + i] = v % 256; v = Math.floor(v / 256); }
  return p + n;
}
function uibGetInt(buf, p, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + buf[p + i];
  return v;
}

function uibCreate(width, height, frames, space) {
  width = width | 0; height = height | 0; frames = frames | 0;
  if (!(width > 0 && height > 0 && frames > 0)) throw new Error('UIB: нулевая геометрия');
  space = uibSpaceId(space);

  const fb = uibBytesFor(frames);
  const kb = uibBytesFor(Math.max(width, height));
  const off1 = uibPow2(1 + fb + 2 * kb);
  const off2 = frames > 1 ? (off1 + frames * 4 + 7) & ~7 : off1;
  const stride = width * height * 4;

  const buf = new Uint8Array(off2 + frames * stride * 2);
  buf[0] = (uibKof(fb) << 6) | (uibKof(kb) << 4) | (space << 2);
  let p = uibPutInt(buf, 1, frames, fb);
  p = uibPutInt(buf, p, width, kb);
  uibPutInt(buf, p, height, kb);

  return {
    buf, width, height, frames, space, off1, off2, stride,
    px: new Uint16Array(buf.buffer, off2, frames * stride),
    delays: frames > 1 ? new DataView(buf.buffer, off1, frames * 4) : null
  };
}

function uibRead(buf) {
  if (!(buf instanceof Uint8Array)) throw new Error('UIB: ожидался Uint8Array');
  if (buf.length < 4) throw new Error('UIB: буфер короче заголовка');

  const b = buf[0];
  if (b & 3) throw new Error('UIB: неизвестная версия формата (резервные биты ненулевые)');

  const fb = 1 << (b >> 6), kb = 1 << ((b >> 4) & 3), space = (b >> 2) & 3;
  if (space > 2) throw new Error('UIB: зарезервированная цветовая схема');

  const off1 = uibPow2(1 + fb + 2 * kb);
  if (buf.length < off1) throw new Error('UIB: буфер короче заголовка');

  let p = 1;
  const frames = uibGetInt(buf, p, fb); p += fb;
  const width = uibGetInt(buf, p, kb); p += kb;
  const height = uibGetInt(buf, p, kb);
  if (!(width > 0 && height > 0 && frames > 0)) throw new Error('UIB: нулевая геометрия');

  const off2 = frames > 1 ? (off1 + frames * 4 + 7) & ~7 : off1;
  const stride = width * height * 4;
  if (buf.byteLength - off2 !== frames * stride * 2)
    throw new Error('UIB: длина не сходится с заголовком');

  const src = (buf.byteOffset & 1) ? Uint8Array.prototype.slice.call(buf) : buf;

  return {
    buf: src, width, height, frames, space, off1, off2, stride,
    px: new Uint16Array(src.buffer, src.byteOffset + off2, frames * stride),
    delays: frames > 1 ? new DataView(src.buffer, src.byteOffset + off1, frames * 4) : null
  };
}

function uibDelays(u) {
  if (!u.delays) return null;
  const out = new Array(u.frames);
  for (let i = 0; i < u.frames; i++) out[i] = u.delays.getUint32(i * 4, false);
  return out;
}
function uibSetDelays(u, ms) {
  if (!u.delays) return;
  for (let i = 0; i < u.frames; i++) u.delays.setUint32(i * 4, ms[i] >>> 0, false);
}

function uibFromDepth(v, depth) {
  if (depth >= 16) return v & 0xFFFF;
  let out = 0, filled = 0;
  while (filled < 16) { out = (out << depth) | v; filled += depth; }
  return (out >>> (filled - 16)) & 0xFFFF;
}
function uibDepthTable(depth) {
  const n = 1 << depth, t = new Uint16Array(n);
  for (let v = 0; v < n; v++) t[v] = uibFromDepth(v, depth);
  return t;
}

function uibRgbaToHsva(px) {
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / UIB_MAX, g = px[i + 1] / UIB_MAX, b = px[i + 2] / UIB_MAX;
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const d = mx - mn;
    let h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      if (h < 0) h += 6;
    }
    px[i] = (Math.round(h * 65536 / 6)) & 0xFFFF;
    px[i + 1] = mx === 0 ? 0 : Math.round(d / mx * UIB_MAX);
    px[i + 2] = Math.round(mx * UIB_MAX);
  }
  return px;
}

function uibHsvaToRgba(px) {
  for (let i = 0; i < px.length; i += 4) {
    const s = px[i + 1] / UIB_MAX, v = px[i + 2] / UIB_MAX;
    let r, g, b;
    if (s === 0) { r = g = b = v; }
    else {
      const hp = px[i] * 6 / 65536;
      const seg = Math.floor(hp) % 6, f = hp - Math.floor(hp);
      const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
      switch (seg) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q;
      }
    }
    px[i] = Math.round(r * UIB_MAX);
    px[i + 1] = Math.round(g * UIB_MAX);
    px[i + 2] = Math.round(b * UIB_MAX);
  }
  return px;
}

function uibRgbaToHsla(px) {
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / UIB_MAX, g = px[i + 1] / UIB_MAX, b = px[i + 2] / UIB_MAX;
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const d = mx - mn, l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (d !== 0) {
      const den = 1 - Math.abs(2 * l - 1);
      s = den <= 0 ? 0 : d / den;
      if (s > 1) s = 1;
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      if (h < 0) h += 6;
    }
    px[i] = (Math.round(h * 65536 / 6)) & 0xFFFF;
    px[i + 1] = Math.round(s * UIB_MAX);
    px[i + 2] = Math.round(l * UIB_MAX);
  }
  return px;
}

function uibHslaToRgba(px) {
  for (let i = 0; i < px.length; i += 4) {
    const s = px[i + 1] / UIB_MAX, l = px[i + 2] / UIB_MAX;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const hp = px[i] * 6 / 65536;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs((hp % 2) - 1));
      const m = l - c / 2;
      const seg = Math.floor(hp) % 6;
      switch (seg) {
        case 0: r = c; g = x; b = 0; break;
        case 1: r = x; g = c; b = 0; break;
        case 2: r = 0; g = c; b = x; break;
        case 3: r = 0; g = x; b = c; break;
        case 4: r = x; g = 0; b = c; break;
        default: r = c; g = 0; b = x;
      }
      r += m; g += m; b += m;
    }
    px[i] = Math.round(Math.min(1, Math.max(0, r)) * UIB_MAX);
    px[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * UIB_MAX);
    px[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * UIB_MAX);
  }
  return px;
}

function uibConvert(px, from, to) {
  if (from === to) return px;
  if (from === UIB_HSVA) uibHsvaToRgba(px);
  else if (from === UIB_HSLA) uibHslaToRgba(px);
  if (to === UIB_HSVA) uibRgbaToHsva(px);
  else if (to === UIB_HSLA) uibRgbaToHsla(px);
  return px;
}

function uibToImageData(buf, frame) {
  const u = uibRead(buf);
  const f = (frame | 0) || 0;
  if (f < 0 || f >= u.frames) throw new Error('UIB: кадр вне диапазона');
  let px = u.px.subarray(f * u.stride, (f + 1) * u.stride);
  if (u.space !== UIB_RGBA) px = uibConvert(px.slice(), u.space, UIB_RGBA);
  const data = new Uint8ClampedArray(u.stride);
  for (let i = 0; i < u.stride; i++) data[i] = px[i] >> 8;
  return { width: u.width, height: u.height, data };
}

export {
  UIB_RGBA, UIB_HSVA, UIB_HSLA, UIB_NAMES, UIB_MAX,
  uibSpaceId, uibBytesFor, uibKof, uibPow2, uibPutInt, uibGetInt,
  uibCreate, uibRead, uibDelays, uibSetDelays, uibFromDepth, uibDepthTable,
  uibRgbaToHsva, uibHsvaToRgba, uibRgbaToHsla, uibHslaToRgba,
  uibConvert, uibToImageData
};
