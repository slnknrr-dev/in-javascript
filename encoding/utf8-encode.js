/** string → UTF-8 bytes by hand (no TextEncoder); lone surrogates are rejected */
const encodeUtf8 = (s) => {
	const out = [];
	for (const ch of s) {
		const c = ch.codePointAt(0);
		if (c >= 0xd800 && c <= 0xdfff) throw new TypeError('utf8: lone surrogate in string');
		if (c < 0x80) out.push(c);
		else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
		else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
		else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
	}
	return Uint8Array.from(out);
};

export { encodeUtf8 };
