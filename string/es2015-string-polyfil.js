/* String: startsWith, endsWith, repeat, codePointAt, fromCodePoint, raw — ES2015 */
(function () {
  function check(self) {
    if (self === null || self === undefined) throw new TypeError('String.prototype method called on null or undefined');
    return String(self);
  }
  function notRegExp(search, method) {
    if (Object.prototype.toString.call(search) === '[object RegExp]')
      throw new TypeError('First argument to String.prototype.' + method + ' must not be a regular expression');
  }

  __dg_define(String.prototype, 'startsWith', function (search, position) {
    var s = check(this);
    notRegExp(search, 'startsWith');
    var at = Math.min(Math.max(__dg_toInt(position), 0), s.length);
    return s.slice(at, at + String(search).length) === String(search);
  });

  __dg_define(String.prototype, 'endsWith', function (search, endPosition) {
    var s = check(this);
    notRegExp(search, 'endsWith');
    var end = endPosition === undefined ? s.length : Math.min(Math.max(__dg_toInt(endPosition), 0), s.length);
    var str = String(search);
    return s.slice(end - str.length, end) === str;
  });

  __dg_define(String.prototype, 'repeat', function (count) {
    var s = check(this);
    var n = __dg_toInt(count);
    if (n < 0 || n === Infinity) throw new RangeError('Invalid count value');
    var out = '';
    while (n-- > 0) out += s;
    return out;
  });

  __dg_define(String.prototype, 'codePointAt', function (position) {
    var s = check(this);
    var i = __dg_toInt(position);
    if (i < 0 || i >= s.length) return undefined;
    var first = s.charCodeAt(i);
    if (first >= 0xD800 && first <= 0xDBFF && i + 1 < s.length) {
      var second = s.charCodeAt(i + 1);
      if (second >= 0xDC00 && second <= 0xDFFF) return (first - 0xD800) * 0x400 + second - 0xDC00 + 0x10000;
    }
    return first;
  });

  __dg_define(String, 'fromCodePoint', function () {
    var out = '';
    for (var i = 0; i < arguments.length; i++) {
      var cp = +arguments[i];
      if (cp < 0 || cp > 0x10FFFF || Math.floor(cp) !== cp) throw new RangeError('Invalid code point ' + cp);
      if (cp <= 0xFFFF) out += String.fromCharCode(cp);
      else {
        var v = cp - 0x10000;
        out += String.fromCharCode(0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF));
      }
    }
    return out;
  });

  __dg_define(String, 'raw', function (strings) {
    var raw = strings.raw, out = '';
    for (var i = 0; i < raw.length; i++) {
      out += raw[i];
      if (i + 1 < arguments.length && i + 1 < raw.length) out += arguments[i + 1];
    }
    return out;
  });
})();
