import { Random } from './random.js';
import { LCG } from './lcg-prng.js';

class RandomInt extends Random {
	constructor(prng = new LCG()) {
		super(prng);

		const random = (...args) => {
			if (args.length == 0)
				return this.randbelow(0, Date.now());
			if (args.length == 1) {
				if (args[0] == 0)
					throw new RangeError();
				if (args[0] < 0)
					return this.randbelow(0, (2**Math.abs(args[0])-1));
				return this.randbelow(0, args[0]);
			}
			if (args.length == 2)
				return this.randbelow(...args);
			throw new Error();
		}

		Object.setPrototypeOf(random, this);

		return random;
	}
}

class RandomUint extends RandomInt {
	constructor(prng = new LCG()) {
		const random = super(prng);

		const wrapper = (...args) => {
			if (args.length > 2)
				throw new Error();
			if (args.length == 2 && (args[0] < 0 || args[1] < 0))
				throw new Error();
			return Math.abs(random(...args));
		}

		Object.setPrototypeOf(wrapper, this);

		return wrapper;
	}
}

const randomInt = new RandomInt(), randomUint = new RandomUint();

export {
	randomUint as randbelow, randomUint, RandomUint,
	randomInt, RandomInt
}