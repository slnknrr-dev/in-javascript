import { ceilPow } from '../math/pow-operation.js';
import { sqr } from '../math/sqr-operation.js';

import { isBufClass } from './buffer-helper.js';

const encodeHex = (b, ctx = globalThis) => {
	if (typeof b != 'object' || typeof b?.length != 'number')
		throw new TypeError();

	let max = 255;

	for (let i = 0; i != b.length; ++i) {
		const v = b[i], e = v % 1;

		if (v < 0 || e != e || e != 0)
			throw new TypeError();
		if (v > max)
			max = b[i];
	}
	const bw = ceilPow(sqr(ceilPow(max+1, 2), 2), 2);

	if (!sqr(bw, 2))
		throw new RangeError();

	//Uint8Array supports arraylike
	if (bw == 8)
		return (new Uint8Array(b)).toHex();

	const Buf = ctx[`Uint${bw}Array`];

	if (ctx == globalThis && !isBufClass(Buf))
		throw new TypeError();

	const o = new Buf(b);

	return new Uint8Array(
		o.buffer,
		o.byteOffset,
		o.byteLength
	).toHex();
}

export { encodeHex }