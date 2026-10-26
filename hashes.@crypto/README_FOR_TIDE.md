# TIDE — Tunable Injective Discrete-log Encoding

> npm: `@slnknrr/tide-hash.js` · source: [tide-hash.js](tide-hash.js) + [tide-hash-helper.js](tide-hash-helper.js) · walkthrough: [DEMO_FOR_TIDE.md](DEMO_FOR_TIDE.md)

TIDE turns every integer of a domain `[0, size)` into a fixed-length
base64url identifier that

* is **provably collision-free** — the function is injective, not "almost surely";
* is **as hard to invert as a discrete logarithm** in the chosen group;
* costs **exactly `t` modular exponentiations**, so brute force is as expensive as you set;
* depends on a **seed `k`**, so different seeds give unrelated identifiers.

## What it is for

The problem TIDE solves is *pseudonymous identifiers*: you need a stable key
for a person, device or address, and you do not want to store (or publish) the
raw value.

| use case | seed | `t` | why TIDE fits |
|---|---|---|---|
| primary key for emails in your own DB | secret | large | a leaked table cannot be joined with an email list |
| public avatar / profile id (Gravatar-like) | public | 1 | anyone who knows the address can compute it, nobody else learns it |
| anonymous visit counter by IP | secret, rotated daily | very large | counts unique clients without ever storing an IP |
| deduplicating user-submitted identifiers | secret | moderate | equality is preserved exactly, collisions are impossible |

Compared with `SHA-256(value)` or `HMAC(key, value)`:

* a cryptographic hash is *collision-resistant*; TIDE is *collision-free*. For a
  primary key that difference is the whole point;
* `HMAC` is cheap by design; TIDE has a built-in, explicit cost knob;
* bcrypt/scrypt/Argon2 are tunable but salted per record — they cannot serve as
  a lookup key. TIDE is deterministic for a given seed.

## Usage

```js
import { TIDE } from './tide-hash.js';

const h = new TIDE({ size: 32, k: secretBytes, t: 20000 });  // validate once
h(0xc0a80001n);                       // → 'AOrE88M' (bigint in [0, size))
h(Uint8Array.of(192, 168, 0, 1));     // the same, big-endian bytes
h.digest(5n);                         // raw Uint8Array instead of base64url
TIDE.hash(5n, { size: 32 });          // one-shot, validates every call
```

API in short:

| member | meaning |
|---|---|
| `new TIDE({ size, k?, t?, p? })` | `size`: bits (`number`) or exact size (`bigint`); `k`: ≤ 32-byte string/`Uint8Array`; `t` ≥ 1; `p`: your own safe prime |
| `h(x)` | `x` is a `bigint` in `[0, size)` or big-endian `Uint8Array` → base64url |
| `h.digest(x)` | the same as bytes |
| `new h(opts)` | a new instance of the same class |
| `h.size`, `h.k`, `h.t`, `h.p`, `h.bytes` | read-only parameters |
| `TIDE.k`, `TIDE.t` | defaults; override them in a subclass |

The default seed is `TIDE.k = '@slnknrr/tide.js'` and the default cost is
`TIDE.t = 10`. Changing either changes every identifier, so pin them in your
own subclass instead of relying on the defaults.

## How it works (one paragraph)

`n` is first permuted over `[0, q)` by a 12-round Feistel network keyed by `k`
(ChaCha20 as the round function, cycle-walking to stay below `q`), then mapped
`t` times through `x ↦ min(4^x mod p, p − 4^x mod p) − 1` where `p = 2q + 1` is
a safe prime with `p ≡ 3 (mod 4)`. Every step is a bijection of `[0, q)`, so the
composition is too. The permutation exists because small inputs would otherwise
be small exponents, and those fall to Pollard's kangaroo. Full derivation and
runnable proofs: [DEMO_FOR_TIDE.md §2](DEMO_FOR_TIDE.md#2-why-there-are-no-collisions).

The group: if `p` is not given, it is derived from `size` — up to 2^256 the
smallest safe prime with `q ≥ size` (deterministic search, cached), above that
the smallest RFC 3526 MODP group (1536 or 2048 bits) that fits. Output length
is `⌈bits(q − 1) / 8⌉` bytes.

## Nuances and limits

* **Enumerable domains need a secret seed.** IPv4 has 2^32 values; anyone who
  knows `k` hashes them all. Here the irreversibility comes from `k`, not from
  the logarithm. Rotate `k` to forget old identifiers.
* **Small groups make the logarithm easy.** Below a few hundred bits the
  one-way step only adds cost (`t`); the keyed permutation is what hides the
  input.
* **The cost is CPU-only.** GPUs/ASICs speed up modular arithmetic; size `t`
  for the attacker's hardware, not yours.
* **A hostile `p`** with a weak structure passes the primality test. Use the
  built-in groups unless you know why you need another.
* **Your domain mapping is part of the scheme.** It must be injective and
  canonical, or collisions and duplicate ids come from you, not from TIDE
  (see the email ranking in the demo).
* **Speed.** One hash is `t` exponentiations: ~3 µs·t for 33-bit groups,
  ~4 ms per exponentiation at 1536 bits. Cache hot ids.
* **Self-contained.** The class refers to no outer names; `(0, eval)('(' + TIDE + ')')`
  yields a working copy (for workers, iframes, code generation), and subclasses
  keep working.
* **Runtime.** Needs `BigInt`, class static blocks and private fields — ES2022+.
  Older targets are marked unsupported by the artifact builder.

## Ready-made instances

`hashEmail`, `hashIp4`, `hashIp6`, `hashMac` — see [README.md](README.md).

## Building blocks

TIDE embeds its primitives in [tide-hash-helper.js](tide-hash-helper.js) so the
class stays self-contained. The same primitives exist as standalone modules in
the repository:

| primitive | module |
|---|---|
| ChaCha20 block (RFC 8439) | [crypto/chacha20-block.js](../crypto/chacha20-block.js) |
| Feistel permutation + cycle-walking | [crypto/feistel-permutation.js](../crypto/feistel-permutation.js) |
| modular exponentiation | [math/modpow-operation.js](../math/modpow-operation.js) |
| Miller–Rabin, safe primes | [math/prime-detecting.js](../math/prime-detecting.js) |
| bit length of a bigint | [math/bigint-helper.js](../math/bigint-helper.js) |
| bigint ↔ big-endian bytes | [arraybuffer/bigint-encoding.js](../arraybuffer/bigint-encoding.js) |
| UTF-8 encoder | [encoding/utf8-encode.js](../encoding/utf8-encode.js) |
| MAC → bigint | [mac.@string/mac-parse.js](../mac.@string/mac-parse.js) |
| IPv4 / IPv6 → bigint | [ip4.@string/ip4-parse.js](../ip4.@string/ip4-parse.js), [ip6.@string/ip6-parse.js](../ip6.@string/ip6-parse.js) |
| Punycode (RFC 3492) | [string/punycode-encode.js](../string/punycode-encode.js) |
