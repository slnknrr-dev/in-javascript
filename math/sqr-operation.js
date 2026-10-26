import { hasBigIntParam } from './bigint-helper.js';

const isSqr2 = n => n > 0 && (n & (n - 1)) === 0;

const sqrBig = (n, b) => {
	const bn = BigInt(n), bb = BigInt(b);

	if (bn < 0n || bb < 0n)
		throw new RangeError();
	if (bb == 0n) return 1;
	if (bb == 1n) return 0;

	let t = 1n, r = 0;

	while (t < bn) {
		t *= bb;
		++r;
	}

	return t == bn ? r : 0;
};

const sqr = (n, b = 2) => {
	if (hasBigIntParam(n, b))
		return sqrBig(n, b);

	if (n < 0 || b < 0)
		throw new RangeError();
	if (b == 0) return 1;
	if (b == 1) return 0;

	if (!Number.isSafeInteger(n) || !Number.isSafeInteger(b))
		return sqrBig(n, b);

	let t = 1, r = 0;

	while (t < n) {
		// t * b would exceed n, so n cannot be b^r
		if (t > n / b)
			return 0;

		t *= b;
		++r;
	}

	return t == n ? r : 0;
};

export { sqrBig, sqr, isSqr2 }