import { Random } from '../crypto/random.js';

import { CSPRNG } from '../crypto/csprng-prng.js';
import { LCG } from '../crypto/lcg-prng.js';

const PRNG = typeof crypto == 'object' && typeof crypto?.getRandomValues == 'function'
	? CSPRNG
	: LCG;

class RandomMac extends Random {
	constructor(prng = new PRNG()) {
		super(prng);

		const rnd = () => ('0'+this.randbelow(0, 255).toString(16)).slice(-2).toUpperCase();

		const random = () => {
			return [
				rnd(),
				rnd(),
				rnd(),
				rnd(),
				rnd(),
				rnd()
			].join(':');
		}

		Object.setPrototypeOf(random, this);

		return random;
	}
}

const randomMac = new RandomMac();

export {
	randomMac, RandomMac
}