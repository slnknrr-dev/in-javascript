/* Number: isInteger, isSafeInteger, isFinite, isNaN, EPSILON,
   MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, parseInt, parseFloat — ES2015 */
(function () {
  __dg_define(Number, 'isFinite', function (v) { return typeof v === 'number' && isFinite(v); });
  __dg_define(Number, 'isNaN', function (v) { return v !== v; });
  __dg_define(Number, 'isInteger', function (v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  });
  __dg_define(Number, 'isSafeInteger', function (v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && Math.abs(v) <= 9007199254740991;
  });
  __dg_define(Number, 'EPSILON', Math.pow(2, -52));
  __dg_define(Number, 'MAX_SAFE_INTEGER', 9007199254740991);
  __dg_define(Number, 'MIN_SAFE_INTEGER', -9007199254740991);
  __dg_define(Number, 'parseInt', parseInt);
  __dg_define(Number, 'parseFloat', parseFloat);
})();
