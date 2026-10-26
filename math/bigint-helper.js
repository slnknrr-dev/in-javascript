const hasBigIntParam = (...args) => {
	for (const arg of args)
		if (typeof arg == 'bigint') return true;
	return false;
}

/** number of bits in a non-negative bigint (0n → 0) */
const bitLength = (x) => x === 0n ? 0 : x.toString(2).length;

export { hasBigIntParam, bitLength }
