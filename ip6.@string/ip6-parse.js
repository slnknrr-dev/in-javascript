import { parseIPv4 } from '../ip4.@string/ip4-parse.js';

const HEX = /^[0-9a-fA-F]{1,4}$/;

/** RFC 4291 text forms (full, '::' compressed, IPv4-suffixed) → 128-bit bigint, or null */
const parseIPv6 = (s) => {
	const halves = s.split('::');
	if (halves.length > 2) return null;
	const groups = (h) => h === '' ? [] : h.split(':');
	const head = groups(halves[0]), tail = halves.length === 2 ? groups(halves[1]) : [];
	const last = halves.length === 2 ? tail : head;
	let v4 = null;
	if (last.length > 0 && last[last.length - 1].includes('.')) {
		v4 = parseIPv4(last.pop());
		if (v4 === null) return null;
	}
	if (![...head, ...tail].every((g) => HEX.test(g))) return null;
	const explicit = head.length + tail.length + (v4 === null ? 0 : 2);
	if (halves.length === 1 ? explicit !== 8 : explicit > 7) return null;
	const gap = halves.length === 2 ? 8 - explicit : 0;
	let v = 0n;
	for (const g of [...head, ...Array(gap).fill('0'), ...tail]) v = v << 16n | BigInt('0x' + g);
	return v4 === null ? v : v << 32n | v4;
};

export { parseIPv6 };
