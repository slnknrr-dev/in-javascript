const isSetter = (obj, prop) => typeof Object.getOwnPropertyDescriptor(obj, prop)?.set == 'function';

export { isSetter }