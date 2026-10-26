/* Promise.allSettled — ES2020 */
if (typeof Promise === 'function')
  __dg_define(Promise, 'allSettled', function (iterable) {
    var C = this, list = __dg_toArray(iterable), out = [];
    for (var i = 0; i < list.length; i++)
      out.push(C.resolve(list[i]).then(
        function (value) { return { status: 'fulfilled', value: value }; },
        function (reason) { return { status: 'rejected', reason: reason }; }));
    return C.all(out);
  });
