import { Random } from '../crypto/random.js';

import { CSPRNG } from '../crypto/csprng-prng.js';
import { LCG } from '../crypto/lcg-prng.js';

const PRNG = typeof crypto == 'object' && typeof crypto?.getRandomValues == 'function'
	? CSPRNG
	: LCG;

class RandomIp4 extends Random {
	constructor(prng = new PRNG()) {
		super(prng);

		const rnd = () => this.randbelow(0, 255);

		const random = () => {
			return [
				rnd(),
				rnd(),
				rnd(),
				rnd()
			].join('.');
		}

		Object.setPrototypeOf(random, this);

		return random;
	}
}

const randomIp4 = new RandomIp4();

export {
	randomIp4, RandomIp4
}