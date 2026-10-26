/**
 * Keyed permutation of an integer range: a balanced Feistel network over
 * ChaCha20, narrowed to [0, q) by cycle-walking.
 *
 * permutation(q, key)(x) is a bijection of [0, q) for any 32-byte key:
 * Feistel is a permutation of [0, 2^2w), and cycle-walking (re-apply until
 * the value lands below q) restricts a permutation to a sub-range.
 *
 * The same construction is embedded in hashes.@crypto/tide-hash-helper.js
 * (with the key length mixed into the tweak); this is the standalone form.
 */
import { chachaBlock } from './chacha20-block.js';
import { bitLength } from '../math/bigint-helper.js';
import { toBytes, fromBytes } from '../arraybuffer/bigint-encoding.js';

const ROUNDS = 12;

// halves of w bits each, so that 2^2w ≥ q
const feistelParams = (q) => {
	const w = Math.max(1, Math.ceil(bitLength(q) / 2));
	return { w, wn: BigInt(w), wb: Math.ceil(w / 8), mask: (1n << BigInt(w)) - 1n };
};

// round function: compress the input with a chain of ChaCha20 blocks,
// then use the result as the key of a keystream of the required length
const prf = (ctx, round, x) => {
	const inp = toBytes(x, ctx.wb), tag = ctx.w << 8;
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

const feistel = (ctx, x, rounds = ROUNDS) => {
	let l = x >> ctx.wn, r = x & ctx.mask;
	for (let i = 0; i < rounds; i++) [l, r] = [r, l ^ prf(ctx, i, r)];
	return l << ctx.wn | r;
};

/** q: bigint ≥ 1, key: Uint8Array(32) → x ↦ permuted x, a bijection of [0, q) */
const permutation = (q, key) => {
	const ctx = { ...feistelParams(q), key };
	return (x) => {
		do x = feistel(ctx, x); while (x >= q);
		return x;
	};
};

export { feistelParams, feistel, permutation };
