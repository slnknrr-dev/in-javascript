const isGetter = (obj, prop) => typeof Object.getOwnPropertyDescriptor(obj, prop)?.get == 'function';

export { isGetter }