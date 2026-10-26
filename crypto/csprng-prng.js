import { PRNG } from './prng.js';

class CSPRNG extends PRNG {
	constructor(seed = Date.now()) {
		const csprng = () => crypto.getRandomValues(new Uint32Array(1))[0] / seed * 100;

		const singleton = super(csprng);

		if (this.constructor.singleton)
			return this.constructor.singleton;

		return this.constructor.singleton;
	}
}

export { CSPRNG }