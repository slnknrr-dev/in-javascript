/* npm: @slnknrr/tide-hash.js */
/**
 * Building blocks of TIDE (see tide-hash.js): numbers and bytes, ChaCha20, the Feistel
 * round, primality and safe-prime search, base64url.
 *
 * The whole module is one self-contained factory: it refers to no outer names, so
 * tide-hash.js can embed its source and the TIDE class survives (0, eval)('(' + TIDE + ')').
 * Keep it that way: no imports, no references outside the arrow function.
 */
const tideHelpers = () => {
	const MR_BASES = 40;      // Miller–Rabin bases
	const KEY_MAX = 32;       // key bytes (one ChaCha20 key)
	const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

	const SMALL_PRIMES = (() => {
		const out = [], sieve = new Uint8Array(1000);
		for (let i = 2; i < 1000; i++) {
			if (sieve[i]) continue;
			out.push(i);
			for (let j = i * i; j < 1000; j += i) sieve[j] = 1;
		}
		return out;
	})();
	const SMALL_PRIMES_N = SMALL_PRIMES.map(BigInt);

	// ── numbers and bytes ──────────────────────────────────────────

	const bitLength = (x) => x === 0n ? 0 : x.toString(2).length;

	const modPow = (b, e, m) => {
		let r = 1n;
		b %= m;
		while (e > 0n) {
			if (e & 1n) r = r * b % m;
			b = b * b % m;
			e >>= 1n;
		}
		return r;
	};

	const toBytes = (x, n) => {
		const h = x.toString(16).padStart(n * 2, '0'), out = new Uint8Array(n);
		for (let i = 0; i < n; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
		return out;
	};

	// big-endian
	const fromBytes = (b) => {
		let h = '0x0';
		for (const v of b) h += (v < 16 ? '0' : '') + v.toString(16);
		return BigInt(h);
	};

	const utf8 = (s) => {
		const out = [];
		for (const ch of s) {
			const c = ch.codePointAt(0);
			if (c >= 0xd800 && c <= 0xdfff) throw new TypeError('TIDE: lone surrogate in string');
			if (c < 0x80) out.push(c);
			else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
			else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
			else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
		}
		return Uint8Array.from(out);
	};

	// base64url without '=' — like Python's secrets.token_urlsafe
	const b64url = (b) => {
		let s = '';
		for (let i = 0; i < b.length; i += 3) {
			const n = b[i] << 16 | (b[i + 1] ?? 0) << 8 | (b[i + 2] ?? 0);
			s += B64[n >> 18 & 63] + B64[n >> 12 & 63];
			if (i + 1 < b.length) s += B64[n >> 6 & 63];
			if (i + 2 < b.length) s += B64[n & 63];
		}
		return s;
	};

	// string (UTF-8) or bytes → zero-padded 32-byte key + its real length
	const keyBytes = (k) => {
		let kb;
		if (typeof k === 'string') kb = utf8(k);
		else if (k instanceof Uint8Array) kb = k;
		else throw new TypeError('TIDE: k must be a string or a Uint8Array');
		if (kb.length > KEY_MAX) throw new RangeError('TIDE: k is longer than 32 bytes');
		const key = new Uint8Array(KEY_MAX);
		key.set(kb);
		return { key, klen: kb.length };
	};

	// ── ChaCha20 (RFC 8439) ────────────────────────────────────────

	const rotl = (x, n) => x << n | x >>> (32 - n);

	const qr = (s, a, b, c, d) => {
		s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 16);
		s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 12);
		s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 8);
		s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 7);
	};

	// key is 32 bytes; counter and n0..n2 are u32 words; returns 64 bytes
	const chachaBlock = (key, counter, n0, n1, n2) => {
		const init = new Uint32Array(16);
		init[0] = 0x61707865; init[1] = 0x3320646e; init[2] = 0x79622d32; init[3] = 0x6b206574;
		for (let i = 0; i < 8; i++)
			init[4 + i] = key[4 * i] | key[4 * i + 1] << 8 | key[4 * i + 2] << 16 | key[4 * i + 3] << 24;
		init[12] = counter; init[13] = n0; init[14] = n1; init[15] = n2;
		const s = init.slice();
		for (let i = 0; i < 10; i++) {
			qr(s, 0, 4, 8, 12); qr(s, 1, 5, 9, 13); qr(s, 2, 6, 10, 14); qr(s, 3, 7, 11, 15);
			qr(s, 0, 5, 10, 15); qr(s, 1, 6, 11, 12); qr(s, 2, 7, 8, 13); qr(s, 3, 4, 9, 14);
		}
		const out = new Uint8Array(64);
		for (let i = 0; i < 16; i++) {
			const v = s[i] + init[i];
			out[4 * i] = v; out[4 * i + 1] = v >>> 8; out[4 * i + 2] = v >>> 16; out[4 * i + 3] = v >>> 24;
		}
		return out;
	};

	// ── Feistel ────────────────────────────────────────────────────

	// round function: the input is compressed by a chain of ChaCha20 blocks (key ⊕ next
	// 32 input bytes), the result keys a keystream of the required length
	const prf = (ctx, round, x) => {
		const inp = toBytes(x, ctx.wb), tag = ctx.klen | ctx.w << 8;
		let h = ctx.key;
		for (let j = 0, off = 0; off < inp.length; j++, off += 32) {
			const k = new Uint8Array(32);
			for (let i = 0; i < 32; i++) k[i] = h[i] ^ (inp[off + i] ?? 0);
			h = chachaBlock(k, j, round, tag, 1).subarray(0, 32);
		}
		const out = new Uint8Array(ctx.wb);
		for (let j = 0, off = 0; off < out.length; j++, off += 64)
			out.set(chachaBlock(h, j, round, tag, 2).subarray(0, out.length - off), off);
		return fromBytes(out) & ctx.mask;
	};

	// a balanced Feistel network: a permutation of [0, 2^2w)
	const feistel = (ctx, x, rounds) => {
		let l = x >> ctx.wn, r = x & ctx.mask;
		for (let i = 0; i < rounds; i++) [l, r] = [r, l ^ prf(ctx, i, r)];
		return l << ctx.wn | r;
	};

	// Feistel parameters for permuting [0, q): halves of w bits each
	const feistelParams = (q) => {
		const w = Math.max(1, Math.ceil(bitLength(q) / 2));
		return { w, wn: BigInt(w), wb: Math.ceil(w / 8), mask: (1n << BigInt(w)) - 1n };
	};

	// ── primes ─────────────────────────────────────────────────────

	const isProbablePrime = (n) => {
		if (n < 2n) return false;
		for (const b of SMALL_PRIMES_N) {
			if (n === b) return true;
			if (n % b === 0n) return false;
		}
		if (n < 1000000n) return true;
		let d = n - 1n, s = 0;
		while (!(d & 1n)) { d >>= 1n; s++; }
		next: for (let i = 0; i < MR_BASES; i++) {
			let x = modPow(SMALL_PRIMES_N[i], d, n);
			if (x === 1n || x === n - 1n) continue;
			for (let j = 1; j < s; j++) {
				x = x * x % n;
				if (x === n - 1n) continue next;
			}
			return false;
		}
		return true;
	};

	const isSafePrime = (p) => p > 5n && isProbablePrime(p >> 1n) && isProbablePrime(p);

	// the smallest safe prime p = 2q + 1 with q ≥ minQ (q ≥ 3, so p ≡ 3 mod 4);
	// deterministic, so the same size always yields the same group
	const findSafePrime = (minQ) => {
		let q = minQ < 3n ? 3n : minQ | 1n;
		for (; ; q += 2n) {
			const p = 2n * q + 1n;
			let composite = false;
			for (const b of SMALL_PRIMES_N) {
				if (q % b === 0n && q !== b || p % b === 0n && p !== b) { composite = true; break; }
			}
			if (composite) continue;
			// cheap Fermat filter before the full test
			if (q > 1000n && (modPow(2n, q - 1n, q) !== 1n || modPow(2n, p - 1n, p) !== 1n)) continue;
			if (isProbablePrime(q) && isProbablePrime(p)) return p;
		}
	};

	return Object.freeze({
		KEY_MAX, bitLength, modPow, toBytes, fromBytes, utf8, b64url, keyBytes,
		chachaBlock, feistel, feistelParams, isProbablePrime, isSafePrime, findSafePrime,
	});
};

export { tideHelpers };
