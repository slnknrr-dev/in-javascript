/* String.prototype.matchAll — ES2020

   Совпадения собираются сразу, а не лениво: для чистой регулярки
   результат тот же. Итератор — массива, если в движке есть Symbol. */
__dg_define(String.prototype, 'matchAll', function (regexp) {
  if (this == null) throw new TypeError('String.prototype.matchAll called on null or undefined');
  var s = String(this), re, flags;
  if (regexp != null && Object.prototype.toString.call(regexp) === '[object RegExp]') {
    flags = 'flags' in regexp ? String(regexp.flags)
      : (regexp.global ? 'g' : '') + (regexp.ignoreCase ? 'i' : '') + (regexp.multiline ? 'm' : '') +
        (regexp.unicode ? 'u' : '') + (regexp.sticky ? 'y' : '');
    if (flags.indexOf('g') < 0) throw new TypeError('String.prototype.matchAll called with a non-global RegExp argument');
    re = new RegExp(regexp.source, flags);
    re.lastIndex = regexp.lastIndex;
  } else {
    flags = 'g';
    re = new RegExp(regexp === undefined ? '(?:)' : String(regexp), 'g');
  }
  var unicode = flags.indexOf('u') >= 0, out = [], m;
  while ((m = re.exec(s)) !== null) {
    out.push(m);
    if (m[0] === '') {
      var i = re.lastIndex, c = s.charCodeAt(i);
      re.lastIndex = unicode && c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length &&
        s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF ? i + 2 : i + 1;
    }
  }
  if (typeof Symbol === 'function' && Symbol.iterator) return out[Symbol.iterator]();
  var k = 0;
  return { next: function () { return k < out.length ? { value: out[k++], done: false } : { value: undefined, done: true }; } };
});
