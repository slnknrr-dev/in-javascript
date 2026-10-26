class PRNG {
	constructor(f) {
		if (typeof f != 'function')
			throw new Error();

		const w = function PRNG(...args) {
			const v = f(...args);
			if (v % 1 == 0 || v > 1 || v < -1 || v != v)
				throw new Error();
			return v;
		}

		Object.setPrototypeOf(w, this);

		return w;
	}
}

export { PRNG };