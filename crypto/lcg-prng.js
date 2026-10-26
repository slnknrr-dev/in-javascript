import { PRNG } from './prng.js';

class LCG extends PRNG {
	constructor(seed = Date.now()) {
		const a = 1664525, c = 1013904223, m = 2**32;
		let state = seed >>> 0;

		const prng = () => {
			state = (Math.imul(a, state) + c) >>> 0;
			return state / m;
		}

		return super(prng);
	}
}

export { LCG }