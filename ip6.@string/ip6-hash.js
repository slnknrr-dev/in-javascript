import { TIDE } from '../hashes.@crypto/tide-hash.js';
import { parseIPv6 } from './ip6-parse.js';

/**
 * IPv6 address → fixed-length, collision-free id (TIDE over [0, 2^128)).
 *
 * Every text form of one address (full, compressed, with an IPv4 tail, any
 * case) is the same 128-bit number, so it gets the same id.
 *
 * The default instance is cheap (t = 1) with a PUBLIC seed: a stable,
 * shareable id, not an anonymizer. Real IPv6 traffic comes from few,
 * guessable prefixes — pass a secret `k` (and rotate it) to make ids
 * unlinkable, and a larger `t` to make enumeration expensive.
 *
 *   hashIp6('2001:db8::1')                 → 17 bytes, 23 chars
 *   new HashIp6({ k: secret, t: 20000 })    → a private, expensive instance
 */
class HashIp6 extends TIDE {
	static k = 'ip6.@string/ip6-hash';
	static t = 1;

	constructor(opts = {}) {
		const tide = super({ ...opts, size: 128 });

		const value = (ip) => {
			const n = parseIPv6(ip);
			if (n === null) throw new SyntaxError('HashIp6: invalid address ' + ip);
			return n;
		};

		const hash = (ip) => tide(value(ip));

		Object.setPrototypeOf(hash, tide);
		Object.defineProperty(hash, 'digest', { value: (ip) => tide.digest(value(ip)) });

		return hash;
	}

	static hash(ip, opts = {}) {
		return new this(opts)(ip);
	}
}

const hashIp6 = new HashIp6();

export {
	hashIp6, HashIp6
}
