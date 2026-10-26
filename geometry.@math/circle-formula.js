const getRadius = function ({ D = null, c = null, S = null } = this) {
	if (!(this && typeof this == 'object' && this !== globalThis))
		throw new Error();

	if (D != null)
		return D / 2;
	if (c != null)
		return c / (2 * Math.PI);
	if (S != null)
		return Math.sqrt(S / Math.PI);

	throw new Error();
}

const getDiameter = function ({ r = null, c = null, S = null } = this) {
	if (!(this && typeof this == 'object' && this !== globalThis))
		throw new Error();

	if (r != null)
		return 2 * r;
	if (c != null)
		return c / Math.PI;
	if (S != null)
		return 2 * Math.sqrt(S / Math.PI);

	throw new Error();
}

const getCircumference = function ({ r = null, D = null, S = null } = this) {
	if (!(this && typeof this == 'object' && this !== globalThis))
		throw new Error();

	if (r != null)
		return 2 * Math.PI * r;
	if (D != null)
		return Math.PI * D;
	if (S != null)
		return 2 * Math.sqrt(Math.PI * S);

	throw new Error();
}

const getArea = function ({ r = null, D = null, c = null, angle = 360 } = this) {
	if (!(this && typeof this == 'object' && this !== globalThis))
		throw new Error();

	if (angle !== 360) {
		const factor = angle / 360;

		if (r != null)
			return Math.PI * r ** 2 * factor;
		if (D != null)
			return Math.PI * (D / 2) ** 2 * factor;
		if (c != null)
			return c ** 2 / (4 * Math.PI) * factor;

		throw new Error();
	}

	if (r != null)
		return Math.PI * r ** 2;
	if (D != null)
		return Math.PI * (D / 2) ** 2;
	if (c != null)
		return c ** 2 / (4 * Math.PI);

	throw new Error();
}

export {
	getRadius, getDiameter, getCircumference, getArea
}