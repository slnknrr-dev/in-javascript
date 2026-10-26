import { Figure } from './figure.js';

class Rectangle extends Figure {
	static quantities = [
		[ 'S', 'a', 'b' ],
		[ 'P', 'a', 'b' ],
		[ 'D', 'a', 'b' ]
	];

	constructor(parameters) {
		return super(parameters);
	}

	get a() {
		return this.$a;
	}
	set a(v) {
		this.$a = v;
		return this.$a;
	}

	get b() {
		return this.$b;
	}
	set b(v) {
		this.$b = v;
		return this.$b;
	}

	get D() {
		if (
			'$D' in this &&
			this.cacheDeps.get('D')?.a == this.$a &&
			this.cacheDeps.get('D')?.b == this.$b
		)
			return this.$D;

		this.cacheDeps.set('D', {
			a: this.$a,
			b: this.$b
		});

		this.$D = Math.sqrt(this.$a ** 2 + this.$b ** 2);

		return this.$D;
	}

	set D(v) {
		this.$D = v;
		return this.$D;
	}

	get P() {
		if (
			'$P' in this &&
			this.cacheDeps.get('P')?.a == this.$a &&
			this.cacheDeps.get('P')?.b == this.$b
		)
			return this.$P;

		this.cacheDeps.set('P', {
			a: this.$a,
			b: this.$b
		});

		this.$P = 2 * (this.$a + this.$b);

		return this.$P;
	}

	set P(v) {
		this.$P = v;
		return this.$P;
	}

	get S() {
		if (
			'$S' in this &&
			this.cacheDeps.get('S')?.a == this.$a &&
			this.cacheDeps.get('S')?.b == this.$b
		)
			return this.$S;

		this.cacheDeps.set('S', {
			a: this.$a,
			b: this.$b
		});

		this.$S = this.$a * this.$b;

		return this.$S;
	}

	set S(v) {
		this.$S = v;
		return this.$S;
	}
}

export { Rectangle }