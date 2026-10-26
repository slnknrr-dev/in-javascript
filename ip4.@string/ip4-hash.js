import { TIDE } from '../hashes.@crypto/tide-hash.js';
import { parseIPv4 } from './ip4-parse.js';

/**
 * IPv4 address → fixed-length, collision-free id (TIDE over [0, 2^32)).
 *
 * The default instance is cheap (t = 1) with a PUBLIC seed: a stable,
 * shareable id, not an anonymizer. IPv4 has only 2^32 values, so anyone
 * with the seed can hash them all — pass a secret `k` (and rotate it) to
 * make ids unlinkable, and a larger `t` to make enumeration expensive.
 *
 *   hashIp4('192.168.0.1')                  → 'AJ0…' (5 bytes, 7 chars)
 *   new HashIp4({ k: secret, t: 20000 })    → a private, expensive instance
 */
class HashIp4 extends TIDE {
	static k = 'ip4.@string/ip4-hash';
	static t = 1;

	constructor(opts = {}) {
		const tide = super({ ...opts, size: 32 });

		const value = (ip) => {
			const n = parseIPv4(ip);
			if (n === null) throw new SyntaxError('HashIp4: invalid address ' + ip);
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

const hashIp4 = new HashIp4();

export {
	hashIp4, HashIp4
}
