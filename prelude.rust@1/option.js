class Option {
	#is_some;
	#value;

	constructor(is_some, value) {
		this.#is_some = is_some;
		this.#value = value;
	}

	is_some() {
		return this.#is_some;
	}

	is_none() {
		return !this.#is_some;
	}

	is_some_and(f) {
		return this.#is_some && f(this.#value);
	}

	is_none_or(f) {
		return !this.#is_some || f(this.#value);
	}

	as_ref() {
		return this;
	}

	as_mut() {
		return this;
	}

	as_pin_ref() {
		return this;
	}

	as_pin_mut() {
		return this;
	}

	as_deref() {
		return this;
	}

	as_deref_mut() {
		return this;
	}

	copied() {
		return this;
	}

	cloned() {
		return this;
	}

	expect(msg) {
		if (this.#is_some) return this.#value;
		throw new Error(msg);
	}

	unwrap() {
		if (this.#is_some) return this.#value;
		throw new Error();
	}

	unwrap_or(default_value) {
		return this.#is_some ? this.#value : default_value;
	}

	unwrap_or_default() {
		return this.#is_some ? this.#value : undefined;
	}

	unwrap_or_else(f) {
		return this.#is_some ? this.#value : f();
	}

	map(f) {
		return this.#is_some ? new Some(f(this.#value)) : this;
	}

	map_or(default_value, f) {
		return this.#is_some ? f(this.#value) : default_value;
	}

	map_or_else(default_f, f) {
		return this.#is_some ? f(this.#value) : default_f();
	}

	inspect(f) {
		if (this.#is_some) f(this.#value);
		return this;
	}

	and(other) {
		return this.#is_some ? other : this;
	}

	and_then(f) {
		return this.#is_some ? f(this.#value) : this;
	}

	filter(predicate) {
		return this.#is_some && predicate(this.#value) ? this : NONE;
	}

	or(other) {
		return this.#is_some ? this : other;
	}

	or_else(f) {
		return this.#is_some ? this : f();
	}

	xor(other) {
		return this.#is_some === other.#is_some
			? NONE
			: this.#is_some ? this : other;
	}

	zip(other) {
		return this.#is_some && other.#is_some
			? new Some([this.#value, other.#value])
			: NONE;
	}

	zip_with(other, f) {
		return this.#is_some && other.#is_some
			? new Some(f(this.#value, other.#value))
			: NONE;
	}

	unzip() {
		return this.#is_some
			? [new Some(this.#value[0]), new Some(this.#value[1])]
			: [NONE, NONE];
	}

	flatten() {
		return this.#is_some ? this.#value : this;
	}

	transpose() {
		if (!this.#is_some) return OK(NONE);
		return this.#value.is_ok()
			? OK(new Some(this.#value.unwrap()))
			: ERR(this.#value.unwrap_err());
	}

	ok_or(err) {
		return this.#is_some ? OK(this.#value) : ERR(err);
	}

	ok_or_else(f) {
		return this.#is_some ? OK(this.#value) : ERR(f());
	}

	iter() {
		return this.#is_some ? [this.#value][Symbol.iterator]() : [][Symbol.iterator]();
	}

	iter_mut() {
		return this.iter();
	}

	into_iter() {
		return this.iter();
	}

	get_or_insert(value) {
		if (!this.#is_some) {
			this.#is_some = true;
			this.#value = value;
		}

		return this.#value;
	}

	get_or_insert_default() {
		return this.get_or_insert(undefined);
	}

	get_or_insert_with(f) {
		if (!this.#is_some) {
			this.#is_some = true;
			this.#value = f();
		}

		return this.#value;
	}

	insert(value) {
		this.#is_some = true;
		this.#value = value;
		return this.#value;
	}

	take() {
		if (!this.#is_some) return NONE;

		const value = this.#value;

		this.#is_some = false;
		this.#value = undefined;

		return new Some(value);
	}

	take_if(predicate) {
		if (this.#is_some && predicate(this.#value))
			return this.take();

		return NONE;
	}

	replace(value) {
		const old = this.#is_some
			? new Some(this.#value)
			: NONE;

		this.#is_some = true;
		this.#value = value;

		return old;
	}

	contains(value) {
		return this.#is_some && this.#value === value;
	}
}

class Some extends Option {
	constructor(value) {
		super(true, value);
	}
}

class None extends Option {
	constructor() {
		super(false);
	}
}

const NONE = new None();