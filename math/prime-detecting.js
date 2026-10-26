/**
 * Primality for bigints: trial division, then Miller–Rabin with the first
 * 40 prime bases; safe primes p = 2q + 1 and a deterministic search for the
 * smallest one above a bound (the group search of TIDE, hashes.@crypto/).
 */
import { modPow } from './modpow-operation.js';

const MR_BASES = 40;

const SMALL_PRIMES = (() => {
	const out = [], sieve = new Uint8Array(1000);
	for (let i = 2; i < 1000; i++) {
		if (sieve[i]) continue;
		out.push(BigInt(i));
		for (let j = i * i; j < 1000; j += i) sieve[j] = 1;
	}
	return out;
})();

const isProbablePrime = (n) => {
	if (n < 2n) return false;
	for (const b of SMALL_PRIMES) {
		if (n === b) return true;
		if (n % b === 0n) return false;
	}
	if (n < 1000000n) return true;
	let d = n - 1n, s = 0;
	while (!(d & 1n)) { d >>= 1n; s++; }
	next: for (let i = 0; i < MR_BASES; i++) {
		let x = modPow(SMALL_PRIMES[i], d, n);
		if (x === 1n || x === n - 1n) continue;
		for (let j = 1; j < s; j++) {
			x = x * x % n;
			if (x === n - 1n) continue next;
		}
		return false;
	}
	return true;
};

const isSafePrime = (p) => p > 5n && isProbablePrime(p >> 1n) && isProbablePrime(p);

/** the smallest safe prime p = 2q + 1 with q ≥ minQ (q ≥ 3, so p ≡ 3 mod 4) */
const findSafePrime = (minQ) => {
	let q = minQ < 3n ? 3n : minQ | 1n;
	for (; ; q += 2n) {
		const p = 2n * q + 1n;
		let composite = false;
		for (const b of SMALL_PRIMES) {
			if (q % b === 0n && q !== b || p % b === 0n && p !== b) { composite = true; break; }
		}
		if (composite) continue;
		// cheap Fermat filter before the full test
		if (q > 1000n && (modPow(2n, q - 1n, q) !== 1n || modPow(2n, p - 1n, p) !== 1n)) continue;
		if (isProbablePrime(q) && isProbablePrime(p)) return p;
	}
};

export { isProbablePrime, isSafePrime, findSafePrime };
