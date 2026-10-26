import { Random } from '../crypto/random.js';

import { CSPRNG } from '../crypto/csprng-prng.js';
import { LCG } from '../crypto/lcg-prng.js';

const PRNG = typeof crypto == 'object' && typeof crypto?.getRandomValues == 'function'
	? CSPRNG
	: LCG;

class RandomIp6 extends Random {
	constructor(prng = new PRNG()) {
		super(prng);

		const rnd = ()=>(this.randbelow(0, 255).toString(16)+this.randbelow(0, 255).toString(16)).replace(/^0{1,3}/,'');

		const random = () => {
			return [
				rnd(), rnd(), rnd(), rnd(),
				rnd(), rnd(), rnd(), rnd()
			].join(':');
		}
		
		Object.setPrototypeOf(random, this);

		return random;
	}
}

const randomIp6 = new RandomIp6();

export {
	randomIp6, RandomIp6
}