class Filler {
	constructor(prng) {
		if (typeof prng != 'function')
			throw new TypeError();

		const filler = (arr) => {
			for (let i = 0; i != arr.length; ++i)
				arr[i] = prng(0);
			return arr;
		}

		Object.setPrototypeOf(filler, this);

		return filler;
	}
}

export { Filler }