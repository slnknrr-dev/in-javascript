/* Promise.prototype.finally — ES2018 */
if (typeof Promise === 'function')
  __dg_define(Promise.prototype, 'finally', function (onFinally) {
    var C = (this && typeof this.constructor === 'function') ? this.constructor : Promise;
    if (typeof onFinally !== 'function') return this.then(onFinally, onFinally);
    return this.then(
      function (value) { return C.resolve(onFinally()).then(function () { return value; }); },
      function (reason) { return C.resolve(onFinally()).then(function () { throw reason; }); });
  });
