import { Figure } from './figure.js';

class Circle extends Figure {
	static quantities = [
		[ 'S', 'angle' ]
	];

	constructor(parameters) {
		return super(parameters);
	}

	get r() {
		return this.$r;
	}
	set r(v) {
		this.$r = v;
		return this.$r;
	}

	get D() {
		if ('$D' in this && this.cacheDeps.get('D') == this.$r)
			return this.$D;

		this.cacheDeps.set('D', this.$r);
		this.$D = 2 * this.$r;

		return this.$D;
	}
	set D(v) {
		if ('$D' in this && this.cacheDeps.get('D') == this.$r)
			return this.$D;

		this.$D = v;
		this.$r = v / 2;

		this.cacheDeps.set('D', this.$r);

		return this.$D;
	}

	get c() {
		if ('$c' in this && this.cacheDeps.get('c') == this.$r)
			return this.$c;

		this.cacheDeps.set('c', this.$r);
		this.$c = 2 * Math.PI * this.$r;

		return this.$c;
	}

	set c(v) {
		if ('$c' in this && this.cacheDeps.get('c') == this.$r)
			return this.$c;

		this.$c = v;
		this.$r = v / (2 * Math.PI);

		this.cacheDeps.set('c', this.$r);

		return this.$c;
	}

	get S() {
		if ('$S' in this && this.cacheDeps.get('S') == this.$r)
			return this.$S;

		this.cacheDeps.set('S', this.$r);
		this.$S = Math.PI * this.$r ** 2;

		return this.$S;
	}

	set S(v) {
		if ('$S' in this && this.cacheDeps.get('S') == this.$r)
			return this.$S;

		this.$S = v;
		this.$r = Math.sqrt(v / Math.PI);

		this.cacheDeps.set('S', this.$r);

		return this.$S;
	}
}

export { Circle }