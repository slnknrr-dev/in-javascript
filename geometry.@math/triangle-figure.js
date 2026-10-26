import { Figure } from './figure.js';

class Triangle extends Figure {
	static quantities = [
		[ 'S', 'a', 'b', 'c' ],
		[ 'P', 'a', 'b', 'c' ],
		[ 'h', 'a', 'b', 'c' ]
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

	get c() {
		return this.$c;
	}
	set c(v) {
		this.$c = v;
		return this.$c;
	}

	get P() {
		if (
			'$P' in this &&
			this.cacheDeps.get('P')?.a == this.$a &&
			this.cacheDeps.get('P')?.b == this.$b &&
			this.cacheDeps.get('P')?.c == this.$c
		)
			return this.$P;

		this.cacheDeps.set('P', {
			a: this.$a,
			b: this.$b,
			c: this.$c
		});

		this.$P = this.$a + this.$b + this.$c;

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
			this.cacheDeps.get('S')?.b == this.$b &&
			this.cacheDeps.get('S')?.c == this.$c
		)
			return this.$S;

		this.cacheDeps.set('S', {
			a: this.$a,
			b: this.$b,
			c: this.$c
		});

		const p = (this.$a + this.$b + this.$c) / 2;

		this.$S = Math.sqrt(
			p *
			(p - this.$a) *
			(p - this.$b) *
			(p - this.$c)
		);

		return this.$S;
	}

	set S(v) {
		this.$S = v;
		return this.$S;
	}

	get h() {
		if (
			'$h' in this &&
			this.cacheDeps.get('h')?.a == this.$a &&
			this.cacheDeps.get('h')?.b == this.$b &&
			this.cacheDeps.get('h')?.c == this.$c
		)
			return this.$h;

		this.cacheDeps.set('h', {
			a: this.$a,
			b: this.$b,
			c: this.$c
		});

		this.$h = (2 * this.S) / this.$a;

		return this.$h;
	}

	set h(v) {
		this.$h = v;
		return this.$h;
	}
}

export { Triangle };