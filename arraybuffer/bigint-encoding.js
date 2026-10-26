/** bigint ↔ fixed-length big-endian bytes */

/** x → Uint8Array(n), big-endian, zero-padded on the left */
const toBytes = (x, n) => {
	const h = x.toString(16).padStart(n * 2, '0'), out = new Uint8Array(n);
	for (let i = 0; i < n; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
	return out;
};

/** big-endian bytes → bigint */
const fromBytes = (b) => {
	let h = '0x0';
	for (const v of b) h += (v < 16 ? '0' : '') + v.toString(16);
	return BigInt(h);
};

export { toBytes, fromBytes };
