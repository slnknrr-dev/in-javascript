/* String.prototype.isWellFormed, String.prototype.toWellFormed — ES2024:
   одиночный суррогат — не символ; toWellFormed заменяет его на U+FFFD */
(function () {
  function scan(s, fix) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) {
        if (fix) out += s.charAt(i) + s.charAt(i + 1);
        i++;
        continue;
      }
      if (c >= 0xD800 && c <= 0xDFFF) {
        if (!fix) return false;
        out += String.fromCharCode(0xFFFD);
        continue;
      }
      if (fix) out += s.charAt(i);
    }
    return fix ? out : true;
  }
  function check(s) { if (s == null) throw new TypeError('String method called on null or undefined'); return String(s); }
  __dg_define(String.prototype, 'isWellFormed', function () { return scan(check(this), false); });
  __dg_define(String.prototype, 'toWellFormed', function () { return scan(check(this), true); });
})();
