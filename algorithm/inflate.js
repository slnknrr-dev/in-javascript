/* ══════════════════════════════════════════════════════════════════════════
   inflate.js — распаковка DEFLATE (RFC 1951) и zlib-обёртки (RFC 1950)

     inflateRaw(src)  → Uint8Array   сырой deflate-поток
     inflateZlib(src) → Uint8Array   поток с zlib-заголовком

   Не про изображения: DEFLATE — это PNG, gzip, zip, HTTP Content-Encoding,
   woff, jar, docx/xlsx/odt, packfile git.

   Битовый читатель (LSB-first) и канонический Хаффман лежат здесь, а не
   отдельными алгоритмами: в RFC 1951 они заданы вместе с форматом и порознь
   бессмысленны. Хаффман в jpg-format.js (mincode/maxcode/valptr, MSB-first,
   T.81 Annex F) — другое представление той же идеи; сводить их в одну
   абстракцию значило бы переписать горячий цикл обоих кодеков ради общего
   имени, поэтому каждый остаётся у своей спецификации.
   ══════════════════════════════════════════════════════════════════════════ */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffTable(lengths, n) {
  const count = new Int32Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  const offs = new Int32Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  const symbol = new Int32Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

class BitLSB {
  constructor(src) { this.s = src; this.p = 0; this.b = 0; this.n = 0; }
  bit() {
    if (this.n === 0) {
      if (this.p >= this.s.length) throw new Error('inflate: поток оборван');
      this.b = this.s[this.p++]; this.n = 8;
    }
    const v = this.b & 1;
    this.b >>= 1; this.n--;
    return v;
  }
  bits(k) {
    let v = 0;
    for (let i = 0; i < k; i++) v |= this.bit() << i;
    return v;
  }
  align() { this.b = 0; this.n = 0; }
}

function huffDecode(br, h) {
  let code = 0, first = 0, index = 0;
  for (let len = 1; len <= 15; len++) {
    code |= br.bit();
    const cnt = h.count[len];
    if (code - first < cnt) return h.symbol[index + (code - first)];
    index += cnt;
    first = (first + cnt) << 1;
    code <<= 1;
  }
  throw new Error('inflate: некорректный код Хаффмана');
}

let FIXED_LIT = null, FIXED_DIST = null;
function fixedTables() {
  if (FIXED_LIT) return;
  const l = new Uint8Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  FIXED_LIT = huffTable(l, 288);
  const d = new Uint8Array(30).fill(5);
  FIXED_DIST = huffTable(d, 30);
}

/* сырой deflate → Uint8Array */
function inflateRaw(src) {
  const br = new BitLSB(src);
  let out = new Uint8Array(Math.max(1024, src.length * 4)), len = 0;

  const push = v => {
    if (len === out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out); out = bigger;
    }
    out[len++] = v;
  };

  for (;;) {
    const final = br.bit();
    const type = br.bits(2);

    if (type === 0) {
      br.align();
      if (br.p + 4 > src.length) throw new Error('inflate: обрыв stored-блока');
      const n = src[br.p] | (src[br.p + 1] << 8);
      const m = src[br.p + 2] | (src[br.p + 3] << 8);
      br.p += 4;
      if ((n ^ 0xFFFF) !== m) throw new Error('inflate: LEN/NLEN не сходятся');
      if (br.p + n > src.length) throw new Error('inflate: обрыв stored-блока');
      for (let i = 0; i < n; i++) push(src[br.p + i]);
      br.p += n;
    } else if (type === 1 || type === 2) {
      let lit, dist;
      if (type === 1) { fixedTables(); lit = FIXED_LIT; dist = FIXED_DIST; }
      else {
        const hlit = br.bits(5) + 257;
        const hdist = br.bits(5) + 1;
        const hclen = br.bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[CLEN_ORDER[i]] = br.bits(3);
        const clh = huffTable(cl, 19);
        const lens = new Uint8Array(hlit + hdist);
        let i = 0;
        while (i < hlit + hdist) {
          const sym = huffDecode(br, clh);
          if (sym < 16) lens[i++] = sym;
          else if (sym === 16) {
            if (i === 0) throw new Error('inflate: повтор без предыдущей длины');
            const prev = lens[i - 1], r = 3 + br.bits(2);
            for (let j = 0; j < r; j++) lens[i++] = prev;
          } else if (sym === 17) {
            const r = 3 + br.bits(3);
            for (let j = 0; j < r; j++) lens[i++] = 0;
          } else {
            const r = 11 + br.bits(7);
            for (let j = 0; j < r; j++) lens[i++] = 0;
          }
        }
        lit = huffTable(lens.subarray(0, hlit), hlit);
        dist = huffTable(lens.subarray(hlit), hdist);
      }

      for (;;) {
        const sym = huffDecode(br, lit);
        if (sym < 256) push(sym);
        else if (sym === 256) break;
        else {
          const li = sym - 257;
          if (li >= LEN_BASE.length) throw new Error('inflate: недопустимый код длины');
          const l = LEN_BASE[li] + br.bits(LEN_EXTRA[li]);
          const ds = huffDecode(br, dist);
          if (ds >= DIST_BASE.length) throw new Error('inflate: недопустимый код расстояния');
          const d = DIST_BASE[ds] + br.bits(DIST_EXTRA[ds]);
          if (d > len) throw new Error('inflate: расстояние за пределы окна');
          for (let j = 0; j < l; j++) push(out[len - d]);
        }
      }
    } else throw new Error('inflate: зарезервированный тип блока');

    if (final) break;
  }
  return out.subarray(0, len);
}

/* zlib-обёртка */
function inflateZlib(src) {
  if (src.length < 2) throw new Error('zlib: поток слишком короткий');
  const cmf = src[0], flg = src[1];
  if ((cmf & 0x0F) !== 8) throw new Error('zlib: метод сжатия не deflate');
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error('zlib: битый заголовок');
  const start = (flg & 0x20) ? 6 : 2;   // FDICT
  return inflateRaw(src.subarray(start));
}

export { inflateRaw, inflateZlib };
