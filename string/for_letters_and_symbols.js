//es6 snippet from [`for_letters_and_symbols.js`](https://codeberg.org/slnknrr/in-javascript/src/branch/all-in-one/string)
const letterRegexp =
	/\p{L}/gu;

const symbolRegexp =
	/\P{L}/gu;

/**
 * Count Unicode letters in a string.
 * `\p{L}` matches characters from the Unicode Letter category.
*/

const countLettersStr = (s) =>
	s.match(letterRegexp)?.length || 0;

const countSymbolsStr = (s) =>
	s.match(symbolRegexp)?.length || 0;

/**
 * Count characters that are not Unicode letters.
 * `\P{L}` matches characters outside the Unicode Letter category.
*/

function countLettersMethod() {
	return countLettersStr(this);
}

function countSymbolsMethod() {
	return countSymbolsStr(this);
}

export {
	countLettersStr as countLetters, countLettersMethod,
	countSymbolsStr as countSymbols, countSymbolsMethod
}