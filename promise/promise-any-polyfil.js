/* Promise.any и AggregateError — ES2021 */
(function () {
  var g = __dg_global();
  if (typeof g.AggregateError !== 'function') {
    var AggregateError = function AggregateError(errors, message) {
      var self = this instanceof AggregateError ? this : Object.create(AggregateError.prototype);
      var e = new Error(message);
      if (message !== undefined) Object.defineProperty(self, 'message', { value: String(message), writable: true, configurable: true });
      Object.defineProperty(self, 'errors', { value: __dg_toArray(errors), writable: true, configurable: true });
      if (e.stack) Object.defineProperty(self, 'stack', { value: e.stack, writable: true, configurable: true });
      return self;
    };
    AggregateError.prototype = Object.create(Error.prototype, {
      constructor: { value: AggregateError, writable: true, configurable: true },
      name: { value: 'AggregateError', writable: true, configurable: true },
      message: { value: '', writable: true, configurable: true }
    });
    __dg_define(g, 'AggregateError', AggregateError);
  }
  if (typeof Promise === 'function')
    __dg_define(Promise, 'any', function (iterable) {
      var C = this, list = __dg_toArray(iterable);
      return new C(function (resolve, reject) {
        var errors = [], left = list.length;
        if (!left) { reject(new g.AggregateError([], 'All promises were rejected')); return; }
        for (var i = 0; i < list.length; i++) (function (i) {
          C.resolve(list[i]).then(resolve, function (e) {
            errors[i] = e;
            if (--left === 0) reject(new g.AggregateError(errors, 'All promises were rejected'));
          });
        })(i);
      });
    });
})();
