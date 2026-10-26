/*
 * Swiss is a runtime concept dispatcher.
 *
 * It gaslights values into becoming the concept
 * that best knows how to handle them.
 *
 * Use `new concept(value)` when you know better.
*///interface-abstract.js as swiss.js from <https://codeberg.org/slnknrr/in-javascript/src/branch/all-in-one/.@ninjacode>

const Swiss = class ForgotMeNot {
	constructor(concepts = {}) {
		const internal = Symbol('Swiss.assertion');

		const manifests = new Map();
		const manifestsFuncs = new Map();

		/*
		 * Promise-chain mutex.
		 *
		 * Secure registration operations are serialized:
		 *
		 *     gaslightSecure(A)
		 *     gaslightSecure(B)
		 *
		 * cannot mutate the registry concurrently.
		 */
		let secureQueue = Promise.resolve();

		const swiss = value => {
			const assertion = readAssertion(value);

			if (assertion) {
				return force(
					assertion.concept,
					assertion.value
				);
			}

			return dispatch(value);
		};

		/*
		 * ---------------------------------------------------------
		 * Registration
		 * ---------------------------------------------------------
		 */

		const register = (
			concept,
			{
				bouncer = null,
				scapegoat = null,
				amen = []
			} = {},
			atStart = false
		) => {
			validateConcept(concept);

			if (manifests.has(concept)) {
				throw new Error(
					`Concept "${concept}" already exists`
				);
			}

			validateFunction(
				bouncer,
				'bouncer'
			);

			validateFunction(
				scapegoat,
				'scapegoat'
			);

			if (!Array.isArray(amen)) {
				throw new TypeError(
					'amen must be an array'
				);
			}

			const manifest = {
				concept,
				bouncer,
				scapegoat,
				amen: [...amen]
			};

			const func = function (value) {
				if (arguments.length !== 1) {
					throw new TypeError(
						`${concept} expects exactly one argument`
					);
				}

				/*
				 * new swiss.file(value)
				 *
				 * Creates an assertion.
				 * It does not process the value.
				 */
				if (new.target) {
					return Object.freeze({
						[internal]: concept,
						value
					});
				}

				/*
				 * swiss.file(value)
				 *
				 * Explicit concept resolution.
				 * amen is allowed.
				 */
				return resolve(
					concept,
					value,
					new Set()
				);
			};

			/*
			 * Mark the concept function itself.
			 */
			Object.defineProperty(func, internal, {
				value: concept,
				enumerable: false,
				configurable: false,
				writable: false
			});

			/*
			 * manifest = append
			 * gaslight = prepend
			 */
			if (atStart) {
				manifests.set(concept, manifest);

				/*
				 * Map has no native unshift.
				 * Rebuild it with the new concept first.
				 */
				const entries = [
					[concept, manifest],
					...manifests.entries()
				];

				manifests.clear();

				for (const [name, item] of entries) {
					manifests.set(name, item);
				}
			} else {
				manifests.set(concept, manifest);
			}

			manifestsFuncs.set(
				concept,
				func
			);

			Object.defineProperty(
				swiss,
				concept,
				{
					value: func,
					enumerable: true,
					configurable: false,
					writable: false
				}
			);

			return func;
		};

		/*
		 * manifest()
		 *
		 * Add concept to the END.
		 */
		const manifest = (
			concept,
			options = {}
		) => {
			return register(
				concept,
				options,
				false
			);
		};

		/*
		 * gaslight()
		 *
		 * Add concept to the BEGINNING.
		 */
		const gaslight = (
			concept,
			options = {}
		) => {
			return register(
				concept,
				options,
				true
			);
		};

		/*
		 * ---------------------------------------------------------
		 * Secure registration
		 * ---------------------------------------------------------
		 *
		 * These don't make handlers themselves asynchronous.
		 *
		 * They serialize the REGISTRATION MUTATION.
		 *
		 * This is important if several callers do:
		 *
		 *     await Promise.all([
		 *         swiss.gaslightSecure(...),
		 *         swiss.manifestSecure(...),
		 *         swiss.gaslightSecure(...)
		 *     ]);
		 */

		const secure = operation => {
			const result = secureQueue.then(
				() => operation()
			);

			/*
			 * Keep the queue alive even if one operation fails.
			 */
			secureQueue = result.catch(
				() => {}
			);

			return result;
		};

		const manifestSecure = async (
			concept,
			options = {}
		) => {
			return secure(() =>
				manifest(
					concept,
					options
				)
			);
		};

		const gaslightSecure = async (
			concept,
			options = {}
		) => {
			return secure(() =>
				gaslight(
					concept,
					options
				)
			);
		};

		/*
		 * ---------------------------------------------------------
		 * Assertions
		 * ---------------------------------------------------------
		 */

		const readAssertion = value => {
			if (
				value === null ||
				(
					typeof value !== 'object' &&
					typeof value !== 'function'
				)
			) {
				return null;
			}

			/*
			 * IMPORTANT:
			 *
			 * `in`, not hasOwnProperty.
			 *
			 * Assertions are inheritable.
			 */
			if (!(internal in value)) {
				return null;
			}

			const concept = value[internal];

			if (
				typeof concept !== 'string' ||
				!manifests.has(concept)
			) {
				return null;
			}

			return {
				concept,
				value: value.value
			};
		};

		/*
		 * ---------------------------------------------------------
		 * Forced resolution
		 * ---------------------------------------------------------
		 *
		 * Assertion path:
		 *
		 *     new swiss.file(value)
		 *              ↓
		 *     swiss(assertion)
		 *              ↓
		 *          force(file)
		 *
		 * NO AMEN.
		 */

		const force = (
			concept,
			value
		) => {
			const manifest =
				manifests.get(concept);

			if (!manifest) {
				throw new Error(
					`Unknown concept "${concept}"`
				);
			}

			if (manifest.bouncer) {
				let accepted;

				try {
					accepted =
						!!manifest.bouncer(value);
				} catch {
					accepted = false;
				}

				if (!accepted) {
					throw new Error(
						`Value rejected by "${concept}"`
					);
				}
			}

			if (!manifest.scapegoat) {
				throw new Error(
					`Concept "${concept}" has no handler`
				);
			}

			/*
			 * Deliberately uncaught.
			 *
			 * Forced assertion cannot fallback.
			 */
			return manifest.scapegoat(value);
		};

		/*
		 * ---------------------------------------------------------
		 * Normal resolution
		 * ---------------------------------------------------------
		 *
		 * Iterative traversal.
		 *
		 * No recursive amen calls.
		 * No duplicate concept execution.
		 */

		const resolve = (
			startConcept,
			value,
			visited = new Set()
		) => {
			const queue = [startConcept];

			while (queue.length) {
				const concept =
					queue.shift();

				if (visited.has(concept)) {
					continue;
				}

				visited.add(concept);

				const manifest =
					manifests.get(concept);

				if (!manifest) {
					continue;
				}

				/*
				 * Bouncer.
				 */
				if (manifest.bouncer) {
					let accepted = false;

					try {
						accepted =
							!!manifest.bouncer(value);
					} catch {
						accepted = false;
					}

					if (!accepted) {
						enqueueAmen(
							manifest,
							queue,
							visited
						);

						continue;
					}
				}

				/*
				 * Handler.
				 */
				if (manifest.scapegoat) {
					try {
						return manifest.scapegoat(value);
					} catch {
						// Try amen.
					}
				}

				/*
				 * Fallback.
				 */
				enqueueAmen(
					manifest,
					queue,
					visited
				);
			}

			throw new Error(
				`Swiss could not resolve value as "${startConcept}"`
			);
		};

		const enqueueAmen = (
			manifest,
			queue,
			visited
		) => {
			for (const concept of manifest.amen) {
				if (
					typeof concept !== 'string'
				) {
					continue;
				}

				if (visited.has(concept)) {
					continue;
				}

				if (!manifests.has(concept)) {
					continue;
				}

				queue.push(concept);
			}
		};

		/*
		 * ---------------------------------------------------------
		 * Automatic dispatch
		 * ---------------------------------------------------------
		 *
		 * Map insertion order is the dispatch priority.
		 *
		 * gaslight()  -> higher priority
		 * manifest()  -> lower priority
		 */

		const dispatch = value => {
			const visited = new Set();

			for (
				const concept of manifests.keys()
			) {
				if (visited.has(concept)) {
					continue;
				}

				try {
					return resolve(
						concept,
						value,
						visited
					);
				} catch {
					// Continue.
				}
			}

			throw new Error(
				'Swiss could not recognize value'
			);
		};

		/*
		 * ---------------------------------------------------------
		 * Public API
		 * ---------------------------------------------------------
		 */

		Object.defineProperties(swiss, {
			manifest: {
				value: manifest,
				enumerable: false,
				configurable: false,
				writable: false
			},

			gaslight: {
				value: gaslight,
				enumerable: false,
				configurable: false,
				writable: false
			},

			manifestSecure: {
				value: manifestSecure,
				enumerable: false,
				configurable: false,
				writable: false
			},

			gaslightSecure: {
				value: gaslightSecure,
				enumerable: false,
				configurable: false,
				writable: false
			},

			unwrap: {
				value(value) {
					const assertion =
						readAssertion(value);

					if (!assertion) {
						throw new TypeError(
							'Value is not a Swiss assertion'
						);
					}

					return assertion.value;
				},

				enumerable: false,
				configurable: false,
				writable: false
			},

			conceptOf: {
				value(value) {
					const assertion =
						readAssertion(value);

					return assertion
						? assertion.concept
						: null;
				},

				enumerable: false,
				configurable: false,
				writable: false
			},

			_manifests: {
				value: manifests,
				enumerable: false,
				configurable: false,
				writable: false
			},

			_manifestsFuncs: {
				value: manifestsFuncs,
				enumerable: false,
				configurable: false,
				writable: false
			}
		});

		/*
		 * ---------------------------------------------------------
		 * Constructor declarations
		 * ---------------------------------------------------------
		 *
		 * Object insertion order becomes initial priority.
		 *
		 * Constructor uses manifest(), therefore:
		 *
		 *     { a, b, c }
		 *
		 * becomes:
		 *
		 *     a → b → c
		 */

		for (const [
			concept,
			options
		] of Object.entries(concepts)) {
			manifest(
				concept,
				options
			);
		}

		/*
		 * The instance is the callable object.
		 */
		return swiss;

		/*
		 * ---------------------------------------------------------
		 * Helpers
		 * ---------------------------------------------------------
		 */

		function validateConcept(concept) {
			if (
				typeof concept !== 'string' ||
				concept.length === 0
			) {
				throw new TypeError(
					'concept must be a non-empty string'
				);
			}

			if (
				concept in swiss ||
				manifests.has(concept)
			) {
				throw new Error(
					`Concept "${concept}" already exists`
				);
			}
		}

		function validateFunction(
			value,
			name
		) {
			if (
				value !== null &&
				typeof value !== 'function'
			) {
				throw new TypeError(
					`${name} must be a function`
				);
			}
		}
	}
};
const Swiss = class ForgotMeNot {
	constructor(concepts = {}) {
		const internal = Symbol('Swiss.assertion');

		const manifests = new Map();
		const manifestsFuncs = new Map();

		/*
		 * Promise-chain mutex.
		 *
		 * Secure registration operations are serialized:
		 *
		 *     gaslightSecure(A)
		 *     gaslightSecure(B)
		 *
		 * cannot mutate the registry concurrently.
		 */
		let secureQueue = Promise.resolve();

		const swiss = value => {
			const assertion = readAssertion(value);

			if (assertion) {
				return force(
					assertion.concept,
					assertion.value
				);
			}

			return dispatch(value);
		};

		/*
		 * ---------------------------------------------------------
		 * Registration
		 * ---------------------------------------------------------
		 */

		const register = (
			concept,
			{
				bouncer = null,
				scapegoat = null,
				amen = []
			} = {},
			atStart = false
		) => {
			validateConcept(concept);

			if (manifests.has(concept)) {
				throw new Error(
					`Concept "${concept}" already exists`
				);
			}

			validateFunction(
				bouncer,
				'bouncer'
			);

			validateFunction(
				scapegoat,
				'scapegoat'
			);

			if (!Array.isArray(amen)) {
				throw new TypeError(
					'amen must be an array'
				);
			}

			const manifest = {
				concept,
				bouncer,
				scapegoat,
				amen: [...amen]
			};

			const func = function (value) {
				if (arguments.length !== 1) {
					throw new TypeError(
						`${concept} expects exactly one argument`
					);
				}

				/*
				 * new swiss.file(value)
				 *
				 * Creates an assertion.
				 * It does not process the value.
				 */
				if (new.target) {
					return Object.freeze({
						[internal]: concept,
						value
					});
				}

				/*
				 * swiss.file(value)
				 *
				 * Explicit concept resolution.
				 * amen is allowed.
				 */
				return resolve(
					concept,
					value,
					new Set()
				);
			};

			/*
			 * Mark the concept function itself.
			 */
			Object.defineProperty(func, internal, {
				value: concept,
				enumerable: false,
				configurable: false,
				writable: false
			});

			/*
			 * manifest = append
			 * gaslight = prepend
			 */
			if (atStart) {
				manifests.set(concept, manifest);

				/*
				 * Map has no native unshift.
				 * Rebuild it with the new concept first.
				 */
				const entries = [
					[concept, manifest],
					...manifests.entries()
				];

				manifests.clear();

				for (const [name, item] of entries) {
					manifests.set(name, item);
				}
			} else {
				manifests.set(concept, manifest);
			}

			manifestsFuncs.set(
				concept,
				func
			);

			Object.defineProperty(
				swiss,
				concept,
				{
					value: func,
					enumerable: true,
					configurable: false,
					writable: false
				}
			);

			return func;
		};

		/*
		 * manifest()
		 *
		 * Add concept to the END.
		 */
		const manifest = (
			concept,
			options = {}
		) => {
			return register(
				concept,
				options,
				false
			);
		};

		/*
		 * gaslight()
		 *
		 * Add concept to the BEGINNING.
		 */
		const gaslight = (
			concept,
			options = {}
		) => {
			return register(
				concept,
				options,
				true
			);
		};

		/*
		 * ---------------------------------------------------------
		 * Secure registration
		 * ---------------------------------------------------------
		 *
		 * These don't make handlers themselves asynchronous.
		 *
		 * They serialize the REGISTRATION MUTATION.
		 *
		 * This is important if several callers do:
		 *
		 *     await Promise.all([
		 *         swiss.gaslightSecure(...),
		 *         swiss.manifestSecure(...),
		 *         swiss.gaslightSecure(...)
		 *     ]);
		 */

		const secure = operation => {
			const result = secureQueue.then(
				() => operation()
			);

			/*
			 * Keep the queue alive even if one operation fails.
			 */
			secureQueue = result.catch(
				() => {}
			);

			return result;
		};

		const manifestSecure = async (
			concept,
			options = {}
		) => {
			return secure(() =>
				manifest(
					concept,
					options
				)
			);
		};

		const gaslightSecure = async (
			concept,
			options = {}
		) => {
			return secure(() =>
				gaslight(
					concept,
					options
				)
			);
		};

		/*
		 * ---------------------------------------------------------
		 * Assertions
		 * ---------------------------------------------------------
		 */

		const readAssertion = value => {
			if (
				value === null ||
				(
					typeof value !== 'object' &&
					typeof value !== 'function'
				)
			) {
				return null;
			}

			/*
			 * IMPORTANT:
			 *
			 * `in`, not hasOwnProperty.
			 *
			 * Assertions are inheritable.
			 */
			if (!(internal in value)) {
				return null;
			}

			const concept = value[internal];

			if (
				typeof concept !== 'string' ||
				!manifests.has(concept)
			) {
				return null;
			}

			return {
				concept,
				value: value.value
			};
		};

		/*
		 * ---------------------------------------------------------
		 * Forced resolution
		 * ---------------------------------------------------------
		 *
		 * Assertion path:
		 *
		 *     new swiss.file(value)
		 *              ↓
		 *     swiss(assertion)
		 *              ↓
		 *          force(file)
		 *
		 * NO AMEN.
		 */

		const force = (
			concept,
			value
		) => {
			const manifest =
				manifests.get(concept);

			if (!manifest) {
				throw new Error(
					`Unknown concept "${concept}"`
				);
			}

			if (manifest.bouncer) {
				let accepted;

				try {
					accepted =
						!!manifest.bouncer(value);
				} catch {
					accepted = false;
				}

				if (!accepted) {
					throw new Error(
						`Value rejected by "${concept}"`
					);
				}
			}

			if (!manifest.scapegoat) {
				throw new Error(
					`Concept "${concept}" has no handler`
				);
			}

			/*
			 * Deliberately uncaught.
			 *
			 * Forced assertion cannot fallback.
			 */
			return manifest.scapegoat(value);
		};

		/*
		 * ---------------------------------------------------------
		 * Normal resolution
		 * ---------------------------------------------------------
		 *
		 * Iterative traversal.
		 *
		 * No recursive amen calls.
		 * No duplicate concept execution.
		 */

		const resolve = (
			startConcept,
			value,
			visited = new Set()
		) => {
			const queue = [startConcept];

			while (queue.length) {
				const concept =
					queue.shift();

				if (visited.has(concept)) {
					continue;
				}

				visited.add(concept);

				const manifest =
					manifests.get(concept);

				if (!manifest) {
					continue;
				}

				/*
				 * Bouncer.
				 */
				if (manifest.bouncer) {
					let accepted = false;

					try {
						accepted =
							!!manifest.bouncer(value);
					} catch {
						accepted = false;
					}

					if (!accepted) {
						enqueueAmen(
							manifest,
							queue,
							visited
						);

						continue;
					}
				}

				/*
				 * Handler.
				 */
				if (manifest.scapegoat) {
					try {
						return manifest.scapegoat(value);
					} catch {
						// Try amen.
					}
				}

				/*
				 * Fallback.
				 */
				enqueueAmen(
					manifest,
					queue,
					visited
				);
			}

			throw new Error(
				`Swiss could not resolve value as "${startConcept}"`
			);
		};

		const enqueueAmen = (
			manifest,
			queue,
			visited
		) => {
			for (const concept of manifest.amen) {
				if (
					typeof concept !== 'string'
				) {
					continue;
				}

				if (visited.has(concept)) {
					continue;
				}

				if (!manifests.has(concept)) {
					continue;
				}

				queue.push(concept);
			}
		};

		/*
		 * ---------------------------------------------------------
		 * Automatic dispatch
		 * ---------------------------------------------------------
		 *
		 * Map insertion order is the dispatch priority.
		 *
		 * gaslight()  -> higher priority
		 * manifest()  -> lower priority
		 */

		const dispatch = value => {
			const visited = new Set();

			for (
				const concept of manifests.keys()
			) {
				if (visited.has(concept)) {
					continue;
				}

				try {
					return resolve(
						concept,
						value,
						visited
					);
				} catch {
					// Continue.
				}
			}

			throw new Error(
				'Swiss could not recognize value'
			);
		};

		/*
		 * ---------------------------------------------------------
		 * Public API
		 * ---------------------------------------------------------
		 */

		Object.defineProperties(swiss, {
			manifest: {
				value: manifest,
				enumerable: false,
				configurable: false,
				writable: false
			},

			gaslight: {
				value: gaslight,
				enumerable: false,
				configurable: false,
				writable: false
			},

			manifestSecure: {
				value: manifestSecure,
				enumerable: false,
				configurable: false,
				writable: false
			},

			gaslightSecure: {
				value: gaslightSecure,
				enumerable: false,
				configurable: false,
				writable: false
			},

			unwrap: {
				value(value) {
					const assertion =
						readAssertion(value);

					if (!assertion) {
						throw new TypeError(
							'Value is not a Swiss assertion'
						);
					}

					return assertion.value;
				},

				enumerable: false,
				configurable: false,
				writable: false
			},

			conceptOf: {
				value(value) {
					const assertion =
						readAssertion(value);

					return assertion
						? assertion.concept
						: null;
				},

				enumerable: false,
				configurable: false,
				writable: false
			},

			_manifests: {
				value: manifests,
				enumerable: false,
				configurable: false,
				writable: false
			},

			_manifestsFuncs: {
				value: manifestsFuncs,
				enumerable: false,
				configurable: false,
				writable: false
			}
		});

		/*
		 * ---------------------------------------------------------
		 * Constructor declarations
		 * ---------------------------------------------------------
		 *
		 * Object insertion order becomes initial priority.
		 *
		 * Constructor uses manifest(), therefore:
		 *
		 *     { a, b, c }
		 *
		 * becomes:
		 *
		 *     a → b → c
		 */

		for (const [
			concept,
			options
		] of Object.entries(concepts)) {
			manifest(
				concept,
				options
			);
		}

		/*
		 * The instance is the callable object.
		 */
		return swiss;

		/*
		 * ---------------------------------------------------------
		 * Helpers
		 * ---------------------------------------------------------
		 */

		function validateConcept(concept) {
			if (
				typeof concept !== 'string' ||
				concept.length === 0
			) {
				throw new TypeError(
					'concept must be a non-empty string'
				);
			}

			if (
				concept in swiss ||
				manifests.has(concept)
			) {
				throw new Error(
					`Concept "${concept}" already exists`
				);
			}
		}

		function validateFunction(
			value,
			name
		) {
			if (
				value !== null &&
				typeof value !== 'function'
			) {
				throw new TypeError(
					`${name} must be a function`
				);
			}
		}
	}
};

export { Swiss }