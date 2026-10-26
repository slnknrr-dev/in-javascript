import { hasBigIntParam } from './bigint-helper.js';

const ceilPowBig = (n, b) => {
	const bn = BigInt(n), bb = BigInt(b);

	if (bn < 0n || bb < 0n)
		throw new RangeError();
	if (bb == 0n) return 1;
	if (bb == 1n) return bn;

	let r = 1n;

	while (r < bn)
		r *= bb;

	return r;
};

const ceilPow = (n, b = 2) => {
	if (hasBigIntParam(n, b))
		return ceilPowBig(n, b);

	if (n < 0 || b < 0)
		throw new RangeError();
	if (b == 0) return 1;
	if (b == 1) return n;

	if (!Number.isSafeInteger(n) || !Number.isSafeInteger(b))
		return ceilPowBig(n, b);

	let r = 1;

	while (r < n) {
		if (r > Number.MAX_SAFE_INTEGER / b)
			return ceilPowBig(n, b);

		r *= b;
	}

	return r;
};

export { ceilPow, ceilPowBig }