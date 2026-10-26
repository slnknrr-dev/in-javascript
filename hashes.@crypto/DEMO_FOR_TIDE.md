# TIDE in practice: how it works, shown in code

> npm: `@slnknrr/tide-hash.js` · source: [tide-hash.js](tide-hash.js) · overview: [README_FOR_TIDE.md](README_FOR_TIDE.md)

This article walks through TIDE (Tunable Injective Discrete-log Encoding) from
the first call to three realistic uses: an anonymous IPv4 visit counter, the
same counter for IPv6, and two unrelated identifiers per email address. Each
claim TIDE makes is shown as a runnable check, so the article doubles as the
test suite.

Every listing starts with a `// file:` line. Save it under that name next to
`tide-hash.js` and run it with `node` (22+). Listings that check something use
`node:assert`, so a silent run means everything held.

---

## 1. The first hash

```js
// file: tide-01-first.mjs
import { TIDE } from './tide-hash.js';

const h = new TIDE({ size: 32 });   // the domain is [0, 2^32): every IPv4 address

console.log(h(0xc0a80001n));                         // 192.168.0.1 as a bigint
console.log(h(Uint8Array.of(192, 168, 0, 1)));       // the same number as big-endian bytes
console.log(h.bytes, 'bytes →', h(5n).length, 'base64url chars');
```

`new TIDE(opts)` validates the parameters once and returns a **function**. The
input is an integer of `[0, size)`, as a `bigint` or as big-endian bytes; the
output is a fixed-length base64url string without `=` (like Python's
`secrets.token_urlsafe`). `h.digest(x)` gives the raw bytes instead.

TIDE knows nothing about IPs or emails. Turning *your* value into an integer of
the domain is the caller's job — sections 4–6 show how.

## 2. Why there are no collisions

A hash that is "collision-resistant" only makes collisions unlikely. TIDE is
**injective**: two different inputs can never give the same output. The
pipeline is a chain of bijections:

```
n ∈ [0, size) ⊆ [0, q)
  ─ Feistel over ChaCha20 + cycle-walking   (a permutation of [0, q))   ─► x
  ─ t times: y = 4^x mod p; x = min(y, p − y) − 1   (a bijection of [0, q)) ─► z
  ─ z → fixed-length big-endian bytes → base64url
```

* `p = 2q + 1` is a safe prime, so `x ↦ 4^x` maps `[0, q)` one-to-one onto the
  quadratic residues mod `p`;
* `p ≡ 3 (mod 4)`, so exactly one of `y`, `p − y` is a residue, and
  `y ↦ min(y, p − y) − 1` maps the residues back onto `[0, q)`;
* the output length is fixed by `q`, so dropping `=` merges nothing.

That is a claim we can check exhaustively on small domains:

```js
// file: tide-02-injective.mjs
import assert from 'node:assert/strict';
import { TIDE } from './tide-hash.js';
import { tideHelpers } from './tide-hash-helper.js';

const H = tideHelpers();

// every value of a whole small domain gets its own, equally long id
for (const size of [1n, 2n, 3n, 7n, 100n, 1000n, 4096n]) {
	const h = new TIDE({ size, t: 3 });
	const seen = new Set();
	for (let x = 0n; x < size; x++) {
		const id = h(x);
		assert.equal(id.length, Math.ceil(h.bytes * 4 / 3));
		seen.add(id);
	}
	assert.equal(seen.size, Number(size), `collision at size ${size}`);
}

// with the domain equal to the whole group, the output covers [0, q) exactly
const p = 2039n, q = p >> 1n;   // 1019 is prime, 2039 = 2·1019 + 1
const h = new TIDE({ size: q, p, t: 2 });
const out = new Set();
for (let x = 0n; x < q; x++) out.add(H.fromBytes(h.digest(x)));
assert.equal(out.size, Number(q));
for (const z of out) assert.ok(z >= 0n && z < q);
```

**Why the Feistel step is there at all.** Without it small inputs would be
small exponents, and a discrete logarithm with a small exponent falls to
Pollard's kangaroo in `√n` steps. The keyed permutation spreads the exponent
uniformly over `[0, q)`.

## 3. The knobs: size, seed, cost, group

| option | meaning | default |
|---|---|---|
| `size` | domain: a bit count (`number`) or the exact size (`bigint`) | required |
| `k` | seed — the Feistel key; string of ≤ 32 UTF-8 bytes or `Uint8Array(≤ 32)` | `TIDE.k` |
| `t` | cost — modular exponentiations per hash | `TIDE.t` = 10 |
| `p` | the safe prime; derived from `size` when omitted | auto |

```js
// file: tide-03-options.mjs
import assert from 'node:assert/strict';
import { TIDE } from './tide-hash.js';
import { isSafePrime } from '../math/prime-detecting.js';

// size as bits, bytes as input, determinism, one-shot form
const h = new TIDE({ size: 32 });
assert.equal(h.size, 1n << 32n);
assert.equal(h(0xc0a80001n), h(Uint8Array.of(192, 168, 0, 1)));
assert.equal(h(5n), new TIDE({ size: 32 })(5n));
assert.equal(h(5n), TIDE.hash(5n, { size: 32 }));

// a different seed or cost gives unrelated ids
const a = new TIDE({ size: 64, k: 'a' }), b = new TIDE({ size: 64, k: 'b' });
assert.notEqual(a(42n), b(42n));
assert.notEqual(a(42n), new TIDE({ size: 64, k: 'a', t: 11 })(42n));
assert.notEqual(a(42n), new TIDE({ size: 64, k: new Uint8Array(32).fill(7) })(42n));

// group selection: up to 256 bits a safe prime is searched (deterministic, cached),
// above that the smallest RFC 3526 MODP group that fits
assert.equal(new TIDE({ size: 256 }).bytes, 33);
assert.equal(new TIDE({ size: 257 }).p.toString(2).length, 1536);
assert.equal(new TIDE({ size: 1600 }).p.toString(2).length, 2048);
assert.throws(() => new TIDE({ size: 2100 }), RangeError);   // pass your own p
for (const bits of [1, 8, 33, 100]) {
	const p = new TIDE({ size: bits }).p;
	assert.ok(isSafePrime(p) && p >> 1n >= 1n << BigInt(bits));
}
```

Validation happens once, in the constructor, and every mistake is a clear
`TypeError` / `RangeError`:

```js
// file: tide-04-validation.mjs
import assert from 'node:assert/strict';
import { TIDE } from './tide-hash.js';

assert.throws(() => new TIDE(), TypeError);                                  // no size
assert.throws(() => new TIDE({ size: 0 }), RangeError);
assert.throws(() => new TIDE({ size: 8, t: 0 }), RangeError);
assert.throws(() => new TIDE({ size: 8, k: 'x'.repeat(33) }), RangeError);   // seed > 32 bytes
assert.throws(() => new TIDE({ size: 8, k: 5 }), TypeError);
assert.throws(() => new TIDE({ size: 8, p: 49n }), RangeError);              // not prime
assert.throws(() => new TIDE({ size: 100n, p: 23n }), RangeError);           // group too small

const h = new TIDE({ size: 10n });
assert.throws(() => h(10n), RangeError);    // outside [0, size)
assert.throws(() => h(-1n), RangeError);
assert.throws(() => h(1), TypeError);       // a number, not a bigint
```

## 4. The object model: a class whose instances are functions

An instance is callable, `instanceof TIDE`, has read-only parameters, and
`new` on an instance builds a sibling. Subclasses override the defaults with
static fields. And the class is **self-contained**: `'(' + TIDE + ')'`
evaluates to a working copy anywhere, because `toString` embeds the helper
factory.

```js
// file: tide-05-object-model.mjs
import assert from 'node:assert/strict';
import { TIDE } from './tide-hash.js';

const h = new TIDE({ size: 16, k: 'z', t: 4 });
assert.ok(h instanceof TIDE && typeof h === 'function');
assert.equal(h.call(null, 9n), h(9n));
const h2 = new h({ size: 16, k: 'z', t: 4 });
assert.ok(h2 instanceof TIDE);
assert.equal(h2(9n), h(9n));
assert.throws(() => { 'use strict'; h.t = 1; }, TypeError);

// project-wide defaults through a subclass
class Mine extends TIDE { static k = 'mine'; static t = 2; }
const m = new Mine({ size: 20 });
assert.ok(m instanceof Mine);
assert.equal(m(3n), new TIDE({ size: 20, k: 'mine', t: 2 })(3n));
assert.equal(Mine.hash(3n, { size: 20 }), m(3n));

// ship the class as text (a worker, an iframe, a code generator) and get the same ids
const E = (0, eval)('(' + TIDE + ')');
assert.notEqual(E, TIDE);
assert.equal(new E({ size: 40 })(77n), new TIDE({ size: 40 })(77n));
const E2 = (0, eval)('(' + E + ')');
assert.equal(new E2({ size: 40 })(77n), new TIDE({ size: 40 })(77n));
```

---

## 5. Demo: an anonymous visit counter keyed by IPv4

IPv4 has only 2^32 values, so anyone who knows `k` can simply hash them all.
Irreversibility therefore has to come from a **secret seed**, not from the
logarithm. The tracker:

* derives a per-day seed `SHA-256(secret ‖ day)` — yesterday's ids become
  meaningless and today's cannot be linked to them;
* uses an unreasonably large `t`, so that even with a leaked seed enumerating
  2^32 addresses costs 2^32·t exponentiations;
* keeps the last *n* clients in an in-memory LRU `ip → id`, because a large `t`
  makes one hash slow (tens of milliseconds);
* stores only `kv(id, visitCount)` — what you would put in Redis or a database
  never sees a raw IP. The cache is dropped together with the seed.

The address parser is the repository primitive
[ip4.@string/ip4-parse.js](../ip4.@string/ip4-parse.js).

```js
// file: tide-demo-ipv4.mjs
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { TIDE } from './tide-hash.js';
import { parseIPv4 } from '../ip4.@string/ip4-parse.js';

// a per-day 32-byte seed: SHA-256(secret ‖ day)
const daySeed = (secret, day) => createHash('sha256').update(secret).update(day).digest();
const today = (now = new Date()) => now.toISOString().slice(0, 10);

class VisitTracker {
	#secret; #size; #t; #cacheSize; #day; #hash; #cache = new Map();
	/** kv(id, visitCount) — what you would store in Redis / a database */
	visits = new Map();

	constructor({ secret = randomBytes(32), size = 32, t = 20000, cacheSize = 1000, parse }) {
		this.#secret = secret; this.#size = size; this.#t = t; this.#cacheSize = cacheSize;
		this.parse = parse;
	}

	// a new day: new seed, the cache and the counters of the old day are dropped
	#rotate(day) {
		if (day === this.#day) return;
		this.#day = day;
		this.#hash = new TIDE({ size: this.#size, k: daySeed(this.#secret, day), t: this.#t });
		this.#cache.clear();
		this.visits.clear();
	}

	id(ip, now) {
		this.#rotate(today(now));
		const n = this.parse(ip);
		if (n === null) throw new SyntaxError('invalid address: ' + ip);
		const key = n.toString(16);
		let id = this.#cache.get(key);
		if (id === undefined) {
			id = this.#hash(n);
			if (this.#cache.size >= this.#cacheSize) this.#cache.delete(this.#cache.keys().next().value);
		} else {
			this.#cache.delete(key);   // refresh LRU position
		}
		this.#cache.set(key, id);
		return id;
	}

	visit(ip, now) {
		const id = this.id(ip, now);
		this.visits.set(id, (this.visits.get(id) ?? 0) + 1);
		return id;
	}
}

export { daySeed, VisitTracker };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const tracker = new VisitTracker({ parse: parseIPv4 });
	const day1 = new Date('2026-10-19T12:00:00Z'), day2 = new Date('2026-10-20T12:00:00Z');

	let s = performance.now();
	tracker.visit('203.0.113.7', day1);
	const cold = performance.now() - s;
	s = performance.now();
	tracker.visit('203.0.113.7', day1);
	const warm = performance.now() - s;
	tracker.visit('198.51.100.23', day1);

	console.log('day 1 counters:', Object.fromEntries(tracker.visits));
	console.log(`cold hash ${cold.toFixed(1)} ms (t = 20000), cached ${warm.toFixed(3)} ms`);
	console.log('same IP, day 1:', tracker.id('203.0.113.7', day1));
	console.log('same IP, day 2:', tracker.id('203.0.113.7', day2), '← unlinkable after rotation');
}
```

A typical run (ids differ every run: the secret is random):

```
day 1 counters: { AOrE88M: 2, AGvsom4: 1 }
cold hash 55.3 ms (t = 20000), cached 0.020 ms
same IP, day 1: AOrE88M
same IP, day 2: APkd7CA ← unlinkable after rotation
```

What the tracker guarantees, as a check:

```js
// file: tide-demo-ipv4.check.mjs
import assert from 'node:assert/strict';
import { VisitTracker } from './tide-demo-ipv4.mjs';
import { parseIPv4 } from '../ip4.@string/ip4-parse.js';

assert.equal(parseIPv4('192.168.0.1'), 0xc0a80001n);
assert.equal(parseIPv4('256.0.0.1'), null);
assert.equal(parseIPv4('01.0.0.1'), null);          // leading zeros are ambiguous (octal)

const tr = new VisitTracker({ secret: 's', t: 50, cacheSize: 2, parse: parseIPv4 });
const d1 = new Date('2026-01-01T00:00:00Z'), d2 = new Date('2026-01-02T00:00:00Z');
const a = tr.visit('1.1.1.1', d1);
tr.visit('1.1.1.1', d1);
tr.visit('2.2.2.2', d1); tr.visit('3.3.3.3', d1);   // evicts 1.1.1.1 from the cache
assert.equal(tr.visit('1.1.1.1', d1), a);           // recomputed, same id
assert.equal(tr.visits.get(a), 3);
assert.notEqual(tr.id('1.1.1.1', d2), a);           // a new day, a new id
assert.equal(tr.visits.size, 0);                    // and the old counters are gone
assert.throws(() => tr.id('nope', d2), SyntaxError);
```

## 6. Demo: the same counter for IPv6

All textual forms of one address (full, compressed, with an IPv4 tail, any
case) map to the same 128-bit integer and therefore the same id. The parser is
[ip6.@string/ip6-parse.js](../ip6.@string/ip6-parse.js). A 128-bit group makes
one exponentiation pricier than for IPv4, so `t` is smaller.

```js
// file: tide-demo-ipv6.mjs
import { VisitTracker } from './tide-demo-ipv4.mjs';
import { parseIPv6 } from '../ip6.@string/ip6-parse.js';

const tracker = new VisitTracker({ size: 128, t: 5000, parse: parseIPv6 });
const now = new Date('2026-10-19T12:00:00Z');
for (const ip of ['2001:db8::1', '2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8:0:0:0:0:0.0.0.1', '::ffff:203.0.113.7'])
	console.log(ip.padEnd(42), tracker.visit(ip, now));
console.log('counters:', Object.fromEntries(tracker.visits));
```

```
2001:db8::1                                APPIVVPdzvVMtQP0p-5zXcQ
2001:0DB8:0000:0000:0000:0000:0000:0001    APPIVVPdzvVMtQP0p-5zXcQ
2001:db8:0:0:0:0:0.0.0.1                   APPIVVPdzvVMtQP0p-5zXcQ
::ffff:203.0.113.7                         AFhcRGw8Na-i3Qds2z7WVKc
counters: { 'APPIVVPdzvVMtQP0p-5zXcQ': 3, 'AFhcRGw8Na-i3Qds2z7WVKc': 1 }
```

```js
// file: tide-demo-ipv6.check.mjs
import assert from 'node:assert/strict';
import { parseIPv6 } from '../ip6.@string/ip6-parse.js';

assert.equal(parseIPv6('2001:db8::1'), parseIPv6('2001:0DB8:0:0:0:0:0:1'));
assert.equal(parseIPv6('::'), 0n);
assert.equal(parseIPv6('::ffff:1.2.3.4'), 0xffff01020304n);
assert.equal(parseIPv6('1::2::3'), null);
assert.equal(parseIPv6('1:2:3:4:5:6:7:8:9'), null);
```

## 7. Demo: two identifiers per email

Here the domain is not a fixed-width number, so the work is in the **ranking**:
an injective map from canonical addresses to `[0, N)`, N ≈ 2^1504. With
`size: N` TIDE picks the 1536-bit RFC 3526 group, and the logarithm itself
becomes the hard part.

Two ids come out of one rank:

* **internal** — expensive (large `t`) with a **secret** seed: the primary key
  in your own database. A leaked table cannot be matched against an email list
  without the seed, and even with it every guess costs `t` exponentiations in a
  1536-bit group;
* **external** — cheap (`t = 1`) with a **public** seed: a Gravatar-like public
  identifier anyone can compute from an address they already know.

Different seeds make the two unrelated: the public one reveals nothing about
the internal one. Both are collision-free.

**Canonicalization** — what counts as the same address:

* local-part is compared as is: case-sensitive, no NFC (RFC 5321/6531).
  Redundant quotes and escapes are removed: `"abc"@x ≡ abc@x`,
  `"a\b c"@x ≡ "ab c"@x`;
* domain: ASCII labels → lowercase; non-ASCII labels → NFC + `toLowerCase` +
  punycode (`xn--…`, [string/punycode-encode.js](../string/punycode-encode.js)).
  Full UTS #46 is not implemented;
* domain-literal: `[IPv4]` and `[IPv6:…]` are compared by address value;
  General-address-literal (`[tag:…]`) is not supported — it does not fit the
  capacity;
* limits: local-part ≤ 64 octets, address ≤ 254 octets (RFC 5321) — both as
  given and in canonical form.

**Ranking.** For a local-part of `a` octets there are
`M(a) = H(253 − a) + 2^32 + 2^128` domain choices, where `H(m)` is the number of
strings of length 1..m over the 38-character host alphabet. Then

```
email ↦ Σ_{i<a} 256^i·M(i) + local·M(a) + (index of the domain among M(a))
```

is a mixed-radix number, hence injective.

The parser, the ranking and the hash class live in
[email.@string/email-hash.js](../email.@string/email-hash.js): `hashEmail` is the
cheap public instance, `HashEmail` makes others, `rankEmail` exposes the map
into `[0, N)`.

```js
// file: tide-demo-email.mjs
import { randomBytes } from 'node:crypto';
import { hashEmail, HashEmail, EMAIL_DOMAIN_SIZE as N } from '../email.@string/email-hash.js';

// internal: secret seed (keep it in your secrets store), expensive
const internal = new HashEmail({ k: randomBytes(32), t: 50 });
// external: the default instance — public seed, t = 1
const external = hashEmail;

const emails = ['Alice@Example.COM', '"Alice"@example.com', 'alice@example.com', 'user@[IPv6:::1]', 'пользователь@пример.рф'];
for (const email of emails) {
	let s = performance.now();
	const i = internal(email);
	const ti = performance.now() - s;
	s = performance.now();
	const e = external(email);
	const te = performance.now() - s;
	console.log(email);
	console.log(`  internal (${ti.toFixed(0)} ms): ${i.slice(0, 32)}…`);
	console.log(`  external (${te.toFixed(0)} ms): ${e.slice(0, 32)}…`);
}
console.log(`N ≈ 2^${N.toString(2).length}, id length = ${external('a@b').length} chars`);
```

```js
// file: tide-demo-email.check.mjs
import assert from 'node:assert/strict';
import { hashEmail, HashEmail, rankEmail as rank, EMAIL_DOMAIN_SIZE as N } from '../email.@string/email-hash.js';

assert.equal(rank('"abc"@x.org'), rank('abc@X.ORG'));
assert.equal(rank('"a\\b c"@x'), rank('"ab c"@x'));
assert.equal(rank('u@[IPv6:::1]'), rank('u@[IPv6:0:0:0:0:0:0:0:1]'));
assert.equal(rank('u@пример.рф'), rank('u@xn--e1afmkfd.xn--p1ai'));
assert.notEqual(rank('Alice@x'), rank('alice@x'));   // local-part is case-sensitive
assert.ok(rank('z'.repeat(64) + '@' + 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(61)) < N);
assert.throws(() => rank('no-at'), SyntaxError);
assert.throws(() => rank('a'.repeat(65) + '@x'), RangeError);

const internal = new HashEmail({ k: 'secret', t: 2 });
assert.notEqual(internal('a@b.c'), hashEmail('a@b.c'));
assert.equal(hashEmail('a@B.C'), hashEmail('a@b.c'));
assert.equal(internal('a@b.c').length, 256);
assert.ok(hashEmail instanceof HashEmail && hashEmail.t === 1);
```

---

## 8. Takeaways

* **Pick the domain first.** TIDE is only as good as your map into `[0, size)`:
  it must be injective (or collisions come from you, not from TIDE) and it must
  canonicalize (or one user gets two ids).
* **Small domains need a secret seed.** For IPv4, MAC addresses, phone numbers,
  anything enumerable, the seed is the security; rotate it to forget.
* **`t` is a dial, not a guarantee.** It multiplies the attacker's cost by a
  constant, on CPU; GPUs and ASICs do modular arithmetic faster than you do.
* **Cache the expensive id.** A large `t` costs milliseconds per call; an LRU in
  front of it makes the hot path free.
