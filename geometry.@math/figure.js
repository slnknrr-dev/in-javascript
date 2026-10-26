import { isGetter } from '../object/getter-detect.js';

class Figure {
	static quantities = [];
	cacheDeps = new Map();
	constructor(parameters) {
		let last;
		for (const parameter in parameters) {
			if (last)
				throw new Error();
			if (parameter in this.constructor.prototype && isGetter(this.constructor.prototype, parameter)) {
				last = parameter;
			} else {
				throw new Error();
			}
		}
		this[last] = parameters[last];
	}
}

export { Figure }