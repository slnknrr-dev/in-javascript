//es6 snippet from [`for_even_and_odd.js`](https://codeberg.org/slnknrr/in-javascript/src/branch/all-in-one/number)
const isEvenNum = (n) =>
	typeof n == 'number' &&
	n % 2 == 0;

const isOddNum = (n) =>
	typeof n == 'number' &&
	n % 2 != 0;

/**
 * typeof always returns a string, so == and === are equivalent here.
 * % produces 0 exactly for Number values that are divisible by 2.
 * NaN and ±Infinity produce NaN, so they fail the == 0 check.
 * Fractional values normally produce a non-zero remainder.
 * Note: Number cannot represent every mathematical integer;
 * integer precision is exact only up to 2^53.
*/

function isEvenMethod() {
	return isEvenNum(this);
}

function isOddMethod() {
	return isOddNum(this);
}

export {
	isEvenNum, isEvenMethod as isEven,
	isOddNum, isOddMethod as isOdd
}