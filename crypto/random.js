class Random {
	constructor(prng) {
		this.prng = prng;
	}
	randbelow(min = -128, max = 127) {
		return Math.floor(this.prng() * (max - min + 1)) + min;
	}
}

export { Random }