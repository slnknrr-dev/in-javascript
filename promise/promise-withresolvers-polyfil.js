/* Promise.withResolvers — ES2024 */
if (typeof Promise === 'function')
  __dg_define(Promise, 'withResolvers', function () {
    var out = {};
    out.promise = new this(function (resolve, reject) { out.resolve = resolve; out.reject = reject; });
    return out;
  });
