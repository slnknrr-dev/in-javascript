import { Rectangle } from './rectangle-figure.js';

class Square extends Rectangle {
	constructor(parameters) {
		super(parameters);
	}

	get a() {
		return super.a;
	}

	set a(v) {
		super.a = v;
		super.b = v;
		return v;
	}

	get b() {
		return super.b;
	}

	set b(v) {
		super.a = v;
		super.b = v;
		return v;
	}
}
