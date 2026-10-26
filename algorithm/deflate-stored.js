/* ══════════════════════════════════════════════════════════════════════════
   deflate-stored.js — DEFLATE одними stored-блоками (RFC 1951 §3.2.4)
   в zlib-обёртке (RFC 1950)

     deflateStored(src) → Uint8Array

   Валидный zlib-поток, который прочитает любой инфлейтор и который ничего
   не сжимает: данные режутся на куски по 65535 байт и пишутся как есть,
   плюс заголовок и Adler-32. Нужен там, где формат требует zlib, а
   компрессор не нужен или не написан.

   Не про изображения: этим же приёмом делают заведомо читаемые .zip,
   .gz и PDF-потоки без зависимости от компрессора.
   ══════════════════════════════════════════════════════════════════════════ */

import { adler32 } from './adler32.js';

function deflateStored(src) {
  const blocks = Math.max(1, Math.ceil(src.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + src.length + 4);
  let p = 0;
  out[p++] = 0x78; out[p++] = 0x01;           // CM=8, CINFO=7, FCHECK

  let off = 0;
  for (let i = 0; i < blocks; i++) {
    const n = Math.min(65535, src.length - off);
    out[p++] = (i === blocks - 1) ? 1 : 0;    // BFINAL, BTYPE=00
    out[p++] = n & 0xFF; out[p++] = (n >> 8) & 0xFF;
    out[p++] = (~n) & 0xFF; out[p++] = ((~n) >> 8) & 0xFF;
    out.set(src.subarray(off, off + n), p);
    p += n; off += n;
  }

  const a = adler32(src);
  out[p++] = (a >>> 24) & 0xFF; out[p++] = (a >>> 16) & 0xFF;
  out[p++] = (a >>> 8) & 0xFF; out[p++] = a & 0xFF;
  return out.subarray(0, p);
}

export { deflateStored };
