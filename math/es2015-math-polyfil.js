/* Math: imul, clz32, trunc, sign, log2, log10, log1p, expm1, hypot, cbrt,
   fround, sinh, cosh, tanh, asinh, acosh, atanh — ES2015 */
(function () {
  __dg_define(Math, 'imul', function (a, b) {
    var x = a >>> 0, y = b >>> 0;
    var xh = (x >>> 16) & 0xFFFF, xl = x & 0xFFFF;
    var yh = (y >>> 16) & 0xFFFF, yl = y & 0xFFFF;
    return (xl * yl + (((xh * yl + xl * yh) << 16) >>> 0)) | 0;
  });

  __dg_define(Math, 'clz32', function (x) {
    var v = x >>> 0;
    if (v === 0) return 32;
    var n = 0;
    if ((v & 0xFFFF0000) === 0) { n += 16; v <<= 16; }
    if ((v & 0xFF000000) === 0) { n += 8; v <<= 8; }
    if ((v & 0xF0000000) === 0) { n += 4; v <<= 4; }
    if ((v & 0xC0000000) === 0) { n += 2; v <<= 2; }
    if ((v & 0x80000000) === 0) { n += 1; }
    return n;
  });

  __dg_define(Math, 'trunc', function (x) {
    var v = +x;
    if (v !== v || v === 0 || v === Infinity || v === -Infinity) return v;
    return v < 0 ? Math.ceil(v) : Math.floor(v);
  });

  __dg_define(Math, 'sign', function (x) {
    var v = +x;
    if (v !== v || v === 0) return v;
    return v < 0 ? -1 : 1;
  });

  __dg_define(Math, 'log2', function (x) { return Math.log(x) / Math.LN2; });
  __dg_define(Math, 'log10', function (x) { return Math.log(x) / Math.LN10; });
  __dg_define(Math, 'log1p', function (x) {
    var v = +x;
    if (v < -1) return NaN;
    if (v === 0) return v;
    return Math.abs(v) > 1e-4 ? Math.log(1 + v) : (-0.5 * v + 1) * v;
  });
  __dg_define(Math, 'expm1', function (x) {
    var v = +x;
    if (v === 0) return v;
    return Math.abs(v) < 1e-5 ? v + 0.5 * v * v : Math.exp(v) - 1;
  });

  __dg_define(Math, 'hypot', function () {
    var max = 0, sum = 0, args = arguments, i, v;
    for (i = 0; i < args.length; i++) {
      v = Math.abs(+args[i]);
      if (v === Infinity) return Infinity;
      if (v !== v) sum = sum !== sum ? sum : NaN;
      if (v > max) { sum = sum * (max / v) * (max / v) + 1; max = v; }
      else sum += max === 0 ? 0 : (v / max) * (v / max);
    }
    return max === Infinity ? Infinity : max * Math.sqrt(sum);
  });

  __dg_define(Math, 'cbrt', function (x) {
    var v = +x;
    if (v === 0) return v;
    var r = Math.pow(Math.abs(v), 1 / 3);
    return v < 0 ? -r : r;
  });

  __dg_define(Math, 'fround', function (x) {
    var v = +x;
    if (v !== v || v === 0 || v === Infinity || v === -Infinity) return v;
    /* через запись в float32 и обратно */
    var sign = v < 0 ? -1 : 1;
    var abs = Math.abs(v);
    if (abs < 1.1754943508222875e-38) {
      var step = Math.pow(2, -149);
      return sign * Math.round(abs / step) * step;
    }
    var exp = Math.floor(Math.log(abs) / Math.LN2);
    var scale = Math.pow(2, 23 - exp);
    return sign * Math.round(abs * scale) / scale;
  });

  __dg_define(Math, 'sinh', function (x) { var v = +x; return v === 0 ? v : (Math.exp(v) - Math.exp(-v)) / 2; });
  __dg_define(Math, 'cosh', function (x) { return (Math.exp(+x) + Math.exp(-x)) / 2; });
  __dg_define(Math, 'tanh', function (x) {
    var v = +x;
    if (v === Infinity) return 1;
    if (v === -Infinity) return -1;
    if (v === 0) return v;
    var a = Math.exp(v), b = Math.exp(-v);
    return (a - b) / (a + b);
  });
  __dg_define(Math, 'asinh', function (x) {
    var v = +x;
    if (v === 0 || v !== v || v === Infinity || v === -Infinity) return v;
    return v < 0 ? -Math.log(-v + Math.sqrt(v * v + 1)) : Math.log(v + Math.sqrt(v * v + 1));
  });
  __dg_define(Math, 'acosh', function (x) { var v = +x; return v < 1 ? NaN : Math.log(v + Math.sqrt(v * v - 1)); });
  __dg_define(Math, 'atanh', function (x) {
    var v = +x;
    if (v === 0) return v;
    return Math.log((1 + v) / (1 - v)) / 2;
  });
})();
