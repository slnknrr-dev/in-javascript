const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);

function getULP(value) {
	if (!Number.isFinite(value)) {
		return NaN;
	}

	value = Math.abs(value);

	if (value === 0) {
		return Number.MIN_VALUE;
	}

	view.setFloat64(0, value);

	const high = view.getUint32(0);
	const exponent = (high >>> 20) & 0x7ff;

	// Subnormal numbers.
	if (exponent === 0) {
		return Number.MIN_VALUE;
	}

	return 2 ** (exponent - 1075);
}

function getNextULP(value) {
	if (!Number.isFinite(value)) {
		return NaN;
	}

	value = Math.abs(value);

	if (value === 0) {
		return Number.MIN_VALUE;
	}

	view.setFloat64(0, value);

	let high = view.getUint32(0);
	let low = view.getUint32(4);

	// next representable bit pattern
	if (low === 0xffffffff) {
		high++;
		low = 0;
	} else {
		low++;
	}

	view.setUint32(0, high);
	view.setUint32(4, low);

	return view.getFloat64(0) - value;
}

export { getULP, getNextULP }