/**
 * ChaCha20 block function (RFC 8439, §2.3).
 *
 * key is 32 bytes, counter and n0..n2 are u32 words (the 96-bit nonce);
 * returns one 64-byte keystream block. TIDE uses it as the PRF inside its
 * Feistel rounds (hashes.@crypto/tide-hash.js).
 */
const rotl = (x, n) => x << n | x >>> (32 - n);

const qr = (s, a, b, c, d) => {
	s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 16);
	s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 12);
	s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 8);
	s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 7);
};

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

export { chachaBlock };
