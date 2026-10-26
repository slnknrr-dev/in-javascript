# hashes.@crypto

Hash primitives: functions that map a value to a fixed-length identifier.
Building blocks they share (ciphers, number theory, byte codecs) live in their
own folders — `crypto/`, `math/`, `arraybuffer/`, `encoding/` — and are linked
from each hash's documentation.

| file | what | docs |
|---|---|---|
| [tide-hash.js](tide-hash.js) | **TIDE** — injective, tunable-cost, discrete-log identifiers for any integer domain | [README_FOR_TIDE.md](README_FOR_TIDE.md), [DEMO_FOR_TIDE.md](DEMO_FOR_TIDE.md) |
| [tide-hash-helper.js](tide-hash-helper.js) | TIDE's embedded building blocks (one self-contained factory) | — |

Ready-made TIDE instances in other folders — cheap (`t = 1`) with a public
seed by default; pass a secret `k` and a larger `t` for private ids:

| file | default instance | class | domain |
|---|---|---|---|
| [email.@string/email-hash.js](../email.@string/email-hash.js) | `hashEmail` | `HashEmail` | canonical email addresses, N ≈ 2^1505 |
| [ip4.@string/ip4-hash.js](../ip4.@string/ip4-hash.js) | `hashIp4` | `HashIp4` | 2^32 |
| [ip6.@string/ip6-hash.js](../ip6.@string/ip6-hash.js) | `hashIp6` | `HashIp6` | 2^128 |
| [mac.@string/mac-hash.js](../mac.@string/mac-hash.js) | `hashMac` | `HashMac` | 2^48 (EUI-48) |

Each is a `TIDE` subclass whose instances take the text form directly:
`hashIp4('192.168.0.1')`, `hashMac('aabb.ccdd.eeff')`.

## Conventions

* Tests and demos are not `.js` files here: they are runnable listings inside
  the `.md` files (`// file: …` on the first line — save and run with `node`).
* A file whose first line is `/* npm: <package> */` is published as that npm
  package; the comment is the link between the snippet and the package.
