import { TIDE } from '../hashes.@crypto/tide-hash.js';
import { encodePunycode } from '../string/punycode-encode.js';
import { parseIPv4 } from '../ip4.@string/ip4-parse.js';

/**
 * Email address → fixed-length, collision-free id (TIDE over [0, N), N ≈ 2^1505).
 *
 * The address is canonicalized and ranked into [0, N) by an injective
 * mixed-radix encoding, then hashed by TIDE in the 1536-bit RFC 3526 group.
 * The default instance is cheap (t = 1) with a PUBLIC seed — a Gravatar-like
 * public id anyone can compute from an address they already know. For a
 * private database key use a secret `k` and a larger `t`:
 *
 *   hashEmail('Alice@Example.COM')               → 256 chars
 *   new HashEmail({ k: secret, t: 50 })          → internal, unlinkable ids
 *
 * Canonicalization (what counts as the same address):
 *  - local-part is compared as is: case-sensitive, no NFC (RFC 5321/6531).
 *    Redundant quotes and escapes are removed: "abc"@x ≡ abc@x,
 *    "a\b c"@x ≡ "ab c"@x;
 *  - domain: ASCII labels → lowercase; non-ASCII labels → NFC + toLowerCase +
 *    punycode (xn--…). Full UTS #46 is not implemented;
 *  - domain-literal: [IPv4] and [IPv6:…] are compared by address value;
 *    General-address-literal ([tag:…]) is not supported — it does not fit the capacity.
 * Limits: local-part ≤ 64 octets, address ≤ 254 octets (RFC 5321) — both as given and
 * in canonical form (with the domain as A-labels).
 *
 * Ranking: for a local-part of a octets there are M(a) = H(253 − a) + 2^32 + 2^128
 * domain choices, where H(m) is the number of strings of length 1..m over the
 * 38-character host alphabet; email ↦ Σ_{i<a} 256^i·M(i) + local·M(a) + domain index.
 */

const LOCAL_MAX = 64, ADDR_MAX = 254, DOMAIN_MAX = 253, LABEL_MAX = 63;
const ATEXT = "!#$%&'*+-/=?^_`{|}~";
const HOST = 'abcdefghijklmnopqrstuvwxyz0123456789-.';   // domain alphabet, 38 characters
const BS = String.fromCharCode(92);                      // backslash
const LIT4 = 1n << 32n, LIT6 = 1n << 128n;               // capacity of [IPv4] and [IPv6:…]
const LDH = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const HEX = /^[0-9a-fA-F]{1,4}$/;

const isAscii = (s) => {
	for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
	return true;
};

const utf8 = (s) => {
	if (!s.isWellFormed()) throw new TypeError('email: lone surrogate in string');
	return new TextEncoder().encode(s);
};

const fromBytes = (b) => b.reduce((v, x) => v << 8n | BigInt(x), 0n);

// ── parsing ────────────────────────────────────────────────────────

const isAtext = (ch) => {
	const c = ch.codePointAt(0);
	return c > 127 || c >= 48 && c <= 57 || (c | 32) >= 97 && (c | 32) <= 122 || ATEXT.includes(ch);
};

const isDotAtom = (s) => s.length > 0 && s.split('.').every((a) => a.length > 0 && [...a].every(isAtext));

const canonHost = (d) => {
	const host = d.split('.').map((label) => {
		if (!isAscii(label)) label = label.normalize('NFC');
		label = label.toLowerCase();
		if (!isAscii(label)) label = 'xn--' + encodePunycode(label);
		if (label.length > LABEL_MAX || !LDH.test(label))
			throw new SyntaxError('email: invalid domain label');
		return label;
	}).join('.');
	if (host.length > DOMAIN_MAX) throw new RangeError('email: domain is longer than 253 characters');
	return host;
};

// RFC 5321 address literals: IPv6-full, IPv6-comp (at most 6 explicit groups), IPv6v4-*
const parseIPv6Literal = (s) => {
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
	if (halves.length === 1 ? explicit !== 8 : explicit > 6) return null;
	const gap = halves.length === 2 ? 8 - explicit : 0;
	let v = 0n;
	for (const g of [...head, ...Array(gap).fill('0'), ...tail]) v = v << 16n | BigInt('0x' + g);
	return v4 === null ? v : v << 32n | v4;
};

const canonLiteral = (d) => {
	const body = d.slice(1, -1);
	if (body.slice(0, 5).toLowerCase() === 'ipv6:') {
		const v = parseIPv6Literal(body.slice(5));
		if (v !== null) return { v6: true, ip: v };
	} else {
		const v = parseIPv4(body);
		if (v !== null) return { v6: false, ip: v };
	}
	throw new SyntaxError('email: only [IPv4] and [IPv6:…] literals are supported');
};

// → { local: Uint8Array, host: string } | { local: Uint8Array, v6: boolean, ip: bigint }
const parseEmail = (s) => {
	if (typeof s !== 'string') throw new TypeError('email: must be a string');
	let content, i;
	if (s[0] === '"') {
		content = '';
		for (i = 1; ; i++) {
			if (i >= s.length) throw new SyntaxError('email: unterminated quote in local-part');
			const c = s.codePointAt(i);
			if (c === 34) break;
			if (c === 92) {
				const e = s.charCodeAt(++i);
				if (!(e >= 32 && e <= 126)) throw new SyntaxError('email: invalid escape in local-part');
				content += s[i];
				continue;
			}
			if (c < 32 || c === 127) throw new SyntaxError('email: control character in local-part');
			const ch = String.fromCodePoint(c);
			content += ch;
			i += ch.length - 1;
		}
		i++;
		if (s[i] !== '@') throw new SyntaxError('email: expected @ after the quoted local-part');
	} else {
		i = s.indexOf('@');
		if (i < 0) throw new SyntaxError('email: missing @');
		content = s.slice(0, i);
		if (!isDotAtom(content)) throw new SyntaxError('email: invalid local-part');
	}
	if (utf8(s.slice(0, i)).length > LOCAL_MAX) throw new RangeError('email: local-part is longer than 64 octets');
	if (utf8(s).length > ADDR_MAX) throw new RangeError('email: address is longer than 254 octets');

	let canon = content;
	if (!isDotAtom(content)) {
		canon = '"';
		for (const ch of content) canon += (ch === '"' || ch === BS ? BS : '') + ch;
		canon += '"';
	}
	const local = utf8(canon);

	const d = s.slice(i + 1);
	if (d[0] === '[' && d[d.length - 1] === ']') return { local, ...canonLiteral(d) };
	if (d.length === 0) throw new SyntaxError('email: empty domain');
	const host = canonHost(d);
	if (local.length + 1 + host.length > ADDR_MAX)
		throw new RangeError('email: address is longer than 254 octets in canonical form');
	return { local, host };
};

// ── ranking ──────────────────────────────────────────────────────────

const RANK = (() => {
	const H = [0n];
	for (let b = 1, pw = 1n; b <= DOMAIN_MAX; b++) H.push(H[b - 1] + (pw *= 38n));
	const M = [0n], W = [0n];
	for (let a = 1; a <= LOCAL_MAX; a++) {
		M.push(H[DOMAIN_MAX - a] + LIT4 + LIT6);
		W.push(W[a - 1] + (1n << BigInt(8 * (a - 1))) * M[a - 1]);
	}
	// W[a] = Σ_{1≤i<a} 256^i·M(i) (M[0] = 0); N = W[64] + 256^64·M(64)
	const N = W[LOCAL_MAX] + (1n << BigInt(8 * LOCAL_MAX)) * M[LOCAL_MAX];
	return { H, M, W, N };
})();
const H = RANK.H, M = RANK.M, W = RANK.W, N = RANK.N;

/** email → its index in [0, N): injective, equal for equivalent addresses */
const rankEmail = (email) => {
	const e = parseEmail(email), a = e.local.length;
	let d;
	if (e.host !== undefined) {
		d = H[e.host.length - 1];
		let v = 0n;
		for (const ch of e.host) v = v * 38n + BigInt(HOST.indexOf(ch));
		d += v;
	} else {
		d = H[DOMAIN_MAX - a] + (e.v6 ? LIT4 : 0n) + e.ip;
	}
	return W[a] + fromBytes(e.local) * M[a] + d;
};

// ── the hash ─────────────────────────────────────────────────────────

class HashEmail extends TIDE {
	static k = 'email.@string/email-hash';
	static t = 1;

	constructor(opts = {}) {
		const tide = super({ ...opts, size: N });

		const hash = (email) => tide(rankEmail(email));

		Object.setPrototypeOf(hash, tide);
		Object.defineProperty(hash, 'digest', { value: (email) => tide.digest(rankEmail(email)) });

		return hash;
	}

	static hash(email, opts = {}) {
		return new this(opts)(email);
	}
}

const hashEmail = new HashEmail();

export {
	hashEmail, HashEmail,
	parseEmail, rankEmail, N as EMAIL_DOMAIN_SIZE
}
