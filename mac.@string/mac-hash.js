import { TIDE } from '../hashes.@crypto/tide-hash.js';
import { parseMac } from './mac-parse.js';

/**
 * MAC address (EUI-48) → fixed-length, collision-free id (TIDE over [0, 2^48)).
 *
 * AA:BB:CC:DD:EE:FF, aa-bb-cc-dd-ee-ff, aabb.ccdd.eeff and aabbccddeeff are
 * the same address and get the same id.
 *
 * The default instance is cheap (t = 1) with a PUBLIC seed: a stable,
 * shareable id, not an anonymizer. A MAC is 24 bits of vendor (OUI) plus 24
 * bits of serial, easy to enumerate — pass a secret `k` (and rotate it) to
 * make ids unlinkable, and a larger `t` to make enumeration expensive.
 *
 *   hashMac('AA:BB:CC:DD:EE:FF')            → 7 bytes, 10 chars
 *   new HashMac({ k: secret, t: 20000 })    → a private, expensive instance
 */
class HashMac extends TIDE {
	static k = 'mac.@string/mac-hash';
	static t = 1;

	constructor(opts = {}) {
		const tide = super({ ...opts, size: 48 });

		const value = (ip) => {
			const n = parseMac(ip);
			if (n === null) throw new SyntaxError('HashMac: invalid MAC address ' + ip);
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

const hashMac = new HashMac();

export {
	hashMac, HashMac
}
