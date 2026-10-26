/* Promise.try — ES2025: синхронное исключение становится отклонением */
if (typeof Promise === 'function')
  __dg_define(Promise, 'try', function (fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new this(function (resolve) { resolve(fn.apply(undefined, args)); });
  });
