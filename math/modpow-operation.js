/** b^e mod m for bigints (square-and-multiply) */
const modPow = (b, e, m) => {
	let r = 1n;
	b %= m;
	while (e > 0n) {
		if (e & 1n) r = r * b % m;
		b = b * b % m;
		e >>= 1n;
	}
	return r;
};

export { modPow };
