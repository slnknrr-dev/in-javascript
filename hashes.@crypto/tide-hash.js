/* npm: @slnknrr/tide-hash.js */
import { tideHelpers } from './tide-hash-helper.js';

/**
 * TIDE — Tunable Injective Discrete-log Encoding.
 *
 * Maps every integer of a configured domain [0, size) to a fixed-length identifier that:
 *  - is PROVABLY collision-free (the function is injective, not "almost surely");
 *  - is as hard to invert as a discrete logarithm in the chosen group;
 *  - costs exactly t modular exponentiations, so brute force is as expensive as you set;
 *  - depends on a seed k, so different seeds give unrelated identifiers.
 *
 * TIDE knows nothing about emails, IPs or other formats: a caller turns its value into
 * an integer of [0, size) (or big-endian bytes of that integer) — see DEMO_FOR_TIDE.md.
 *
 * Scheme:
 *   n ∈ [0, size)
 *     ─ keyed permutation of [0, q) (Feistel over ChaCha20, cycle-walking) ─► x
 *     ─ t times: y = 4^x mod p;  x = min(y, p − y) − 1                     ─► z ∈ [0, q)
 *     ─ z → fixed-length big-endian bytes → base64url without '='
 *
 * Why there are no collisions: [0, size) ⊆ [0, q); Feistel with cycle-walking is a
 * permutation of [0, q); x → 4^x is a bijection from [0, q) onto the subgroup of
 * quadratic residues of order q (p = 2q + 1 is a safe prime), and since p ≡ 3 (mod 4)
 * exactly one of y, p − y is a residue, so y → min(y, p − y) − 1 is a bijection from the
 * residues onto [0, q). A composition of bijections is a bijection. The output length is
 * fixed by q, so dropping '=' merges nothing either.
 *
 * Why Feistel: small inputs would be small exponents, and a logarithm with a small
 * exponent falls to Pollard's kangaroo in √n. The permutation makes the exponent uniform.
 *
 * The group: if p is not given, it is derived from size — for size ≤ 2^256 the smallest
 * safe prime with q ≥ size (deterministic search, cached), above that the smallest
 * RFC 3526 MODP group that fits. The output has ⌈bits(q − 1) / 8⌉ bytes.
 *
 * Security notes:
 *  - when the domain is enumerable (IPv4: 2^32), irreversibility comes from a SECRET k,
 *    not from the logarithm; rotate k to forget old identifiers;
 *  - for a small group the logarithm itself is easy; the one-way part then only adds
 *    cost (t), the permutation keyed by a secret k hides the input;
 *  - the cost is CPU-only (GPU/ASIC speed up modular arithmetic);
 *  - a p deliberately chosen with a "weak" structure is not caught by the primality test.
 *
 * API:
 *   const h = new TIDE({ size, k?, t?, p? }) — validates once; size is a bit count
 *                                              (number) or a domain size (bigint);
 *   h(x)          — x is a bigint in [0, size) or a Uint8Array (big-endian) → base64url;
 *   h.digest(x)   — the same as raw bytes (Uint8Array);
 *   new h(opts)   — a new instance of the same class;
 *   h.size, h.k, h.t, h.p, h.bytes — instance parameters (read-only);
 *   TIDE.hash(x, { size, k?, t?, p? }) — one-shot, validates every call;
 *   TIDE.k, TIDE.t — defaults (a subclass may override them).
 * The class is self-contained: it refers neither to outer names nor to its own name
 * (its toString embeds the helpers), so it survives (0, eval)('(' + TIDE + ')') and
 * subclassing.
 */
class TIDE {
	/** Seed (Feistel key): a string of at most 32 UTF-8 bytes or a Uint8Array(≤ 32). */
	static k = '@slnknrr/tide.js';
	/** Cost: number of modular exponentiations. */
	static t = 10;

	static {
		// an instance is a function, so give it call/apply/bind
		Object.setPrototypeOf(this.prototype, Function.prototype);
	}

	// source with the helpers inlined, so '(' + TIDE + ')' evaluates anywhere
	static toString() {
		return '(() => { const tideHelpers = ' + tideHelpers + '; return '
			+ Function.prototype.toString.call(this) + '; })()';
	}

	static #lib = (() => {
		const H = tideHelpers();
		const ROUNDS = 12;        // Feistel rounds
		const SEARCH_MAX = 256;   // above this many bits use a precomputed group

		// RFC 3526 MODP groups 5 (1536 bits) and 14 (2048 bits)
		const MODP_1536 = 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1'
			+ '29024E088A67CC74020BBEA63B139B22514A08798E3404DD'
			+ 'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245'
			+ 'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED'
			+ 'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D'
			+ 'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F'
			+ '83655D23DCA3AD961C62F356208552BB9ED529077096966D';
		const GROUPS = [
			BigInt('0x' + MODP_1536 + '670C354E4ABC9804F1746C08CA237327FFFFFFFFFFFFFFFF'),
			BigInt('0x' + MODP_1536 + '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B'
				+ 'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9'
				+ 'DE2BCBF6955817183995497CEA956AE515D2261898FA0510'
				+ '15728E5A8AACAA68FFFFFFFFFFFFFFFF'),
		];
		const found = new Map();  // size → p, the search is deterministic

		// ── the algorithm ────────────────────────────────────────────

		// cycle-walking: a permutation of [0, 2^2w) is narrowed to a permutation of [0, q)
		const permute = (ctx, x) => {
			do x = H.feistel(ctx, x, ROUNDS); while (x >= ctx.q);
			return x;
		};

		// t times x ↦ min(4^x, p − 4^x) − 1: a bijection of [0, q) that is hard to invert
		const oneWay = (ctx, x) => {
			for (let i = 0; i < ctx.t; i++) {
				const y = H.modPow(4n, x, ctx.p), y2 = ctx.p - y;
				x = (y < y2 ? y : y2) - 1n;
			}
			return x;
		};

		const digest = (ctx, x) => H.toBytes(oneWay(ctx, permute(ctx, input(ctx, x))), ctx.ob);

		// ── parameters ───────────────────────────────────────────────

		const input = (ctx, x) => {
			if (x instanceof Uint8Array) x = H.fromBytes(x);
			else if (typeof x !== 'bigint') throw new TypeError('TIDE: input must be a bigint or a Uint8Array');
			if (x < 0n || x >= ctx.size) throw new RangeError('TIDE: input is outside [0, size)');
			return x;
		};

		const domain = (size) => {
			if (typeof size === 'number') {
				if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('TIDE: size in bits must be an integer ≥ 1');
				return 1n << BigInt(size);
			}
			if (typeof size !== 'bigint') throw new TypeError('TIDE: size must be a number of bits or a bigint');
			if (size < 1n) throw new RangeError('TIDE: size must be ≥ 1');
			return size;
		};

		const group = (size) => {
			if (H.bitLength(size - 1n) <= SEARCH_MAX) {
				if (!found.has(size)) found.set(size, H.findSafePrime(size));
				return found.get(size);
			}
			const p = GROUPS.find((p) => p >> 1n >= size);
			if (p === undefined) throw new RangeError('TIDE: size is too large for the built-in groups, pass p');
			return p;
		};

		const validate = (opts) => {
			if (opts === null || typeof opts !== 'object') throw new TypeError('TIDE: options must be an object');
			const { k, t } = opts, size = domain(opts.size), p = opts.p ?? group(size);
			const { key, klen } = H.keyBytes(k);
			if (!Number.isSafeInteger(t) || t < 1) throw new RangeError('TIDE: t must be an integer ≥ 1');
			if (typeof p !== 'bigint') throw new TypeError('TIDE: p must be a bigint');
			if (p % 4n !== 3n) throw new RangeError('TIDE: p ≡ 3 (mod 4) is required');
			const q = p >> 1n;
			if (q < size) throw new RangeError('TIDE: p is too small for size, collisions are unavoidable');
			if (!H.isSafePrime(p)) throw new RangeError('TIDE: p is not a safe prime (p = 2q + 1 with p and q prime)');
			return Object.freeze({
				size, key, klen, t, p, q, ...H.feistelParams(q),
				ob: Math.max(1, Math.ceil(H.bitLength(q - 1n) / 8)),
			});
		};

		return Object.freeze({ validate, digest, b64url: H.b64url });
	})();

	constructor(opts = {}) {
		const C = new.target;
		let c = C;
		while (!(#lib in c)) c = Object.getPrototypeOf(c);
		const L = c.#lib, k = opts.k ?? C.k, t = opts.t ?? C.t;
		const ctx = L.validate({ ...opts, k, t });
		const hash = function (x) {
			if (new.target)
				return new C(...arguments);
			return L.b64url(L.digest(ctx, x));
		};
		Object.setPrototypeOf(hash, C.prototype);
		Object.defineProperties(hash, {
			size: { value: ctx.size, enumerable: true },
			k: { value: k, enumerable: true },
			t: { value: t, enumerable: true },
			p: { value: ctx.p, enumerable: true },
			bytes: { value: ctx.ob, enumerable: true },
			digest: { value: (x) => L.digest(ctx, x) },
		});
		return hash;
	}

	static hash(x, opts = {}) {
		let c = this;
		while (!(#lib in c)) c = Object.getPrototypeOf(c);
		const L = c.#lib;
		const ctx = L.validate({ ...opts, k: opts.k ?? this.k, t: opts.t ?? this.t });
		return L.b64url(L.digest(ctx, x));
	}
}

export { TIDE, TIDE as Hash };
