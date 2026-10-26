import { Filler } from '../array/filler.js';

class Uint8Filler extends Filler {
	constructor(prng) {
		const wrapper = (...args) => {
			let value = prng(...args);

			if (value != value)
				throw new Error();

			if (value < 0)
				value = -value;

			if (value % 1 != 0) {
				if (value < 1)
					value *= 10000;

				value = Math.floor(value);
			}

			value = ((value - 1) % 255) + 1;

			return value;
		}

		return super(wrapper);
	}
}

export { Uint8Filler }