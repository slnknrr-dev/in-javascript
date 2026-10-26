import { isBufClass } from './buffer-helper.js';

import { isSqr2 } from '../math/sqr-operation.js';

const decodeHexBE = (s, bw = 8, ctx = globalThis) => {
    if (typeof s !== 'string')
        throw new TypeError('s must be a string');

    if (typeof bw != 'number' || bw % 1 != 0)
        throw new TypeError('bw must be a unsigned integer');

    if (!isSqr2(bw))
        throw new RangeError();

    const Buf = ctx[`Uint${bw}Array`];

    if (ctx === globalThis && !isBufClass(Buf))
        throw new TypeError();

    const buf8 = Uint8Array.fromHex(s);
    const bpe = Buf.BYTES_PER_ELEMENT;

    if (buf8.byteLength > bpe)
        throw new RangeError();

    if (buf8.byteLength < bpe) {
        const padded = new Uint8Array(bpe);
        padded.set(buf8, bpe - buf8.byteLength);

        return new Buf(
			padded.buffer,
			padded.byteOffset,
			1
		);
    }

    return new Buf(
        buf8.buffer,
        buf8.byteOffset,
        buf8.byteLength / bpe
    );
};

const decodeHexLE = (s, bw = 8, ctx = globalThis) => {
    if (typeof s !== 'string')
        throw new TypeError('s must be a string');

    if (typeof bw != 'number' || bw % 1 != 0)
        throw new TypeError('bw must be a unsigned integer');

    if (!isSqr2(bw))
        throw new RangeError();

    const Buf = ctx[`Uint${bw}Array`];

    if (ctx === globalThis && !isBufClass(Buf))
        throw new TypeError();

    const buf8 = Uint8Array.fromHex(s);
    const bpe = Buf.BYTES_PER_ELEMENT;

    if (buf8.byteLength < bpe) {
        const padded = new Uint8Array(bpe);
        padded.set(buf8);

        return new Buf(
            padded.buffer,
            padded.byteOffset,
            1
        );
    }

    if (buf8.byteLength % bpe !== 0)
        throw new RangeError();

    return new Buf(
        buf8.buffer,
        buf8.byteOffset,
        buf8.byteLength / bpe
    );
};

export {
	decodeHexLE as decodeHex,
	decodeHexBE, decodeHexLE
}