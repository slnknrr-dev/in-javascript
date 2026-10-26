const fillRandomValues = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
	? (arr) => crypto.getRandomValues(arr)
	: (() => {
		let inc = 0;
		return (arr) => {
			for (let i = 0; i < arr.length; i++) {

				let h = (Date.now() + inc++ + (Math.random() * 0x100000000)) | 0;

				h ^= h >>> 16;
				h = Math.imul(h, 0x85ebca6b);
				h ^= h >>> 13;
				h = Math.imul(h, 0xc2b2ae35);
				h ^= h >>> 16;

				arr[i] = h;
			}
			return arr;
		};
	})();

export function token_bytes(nbytes = 32) {
	return fillRandomValues(new Uint8Array(nbytes));
}