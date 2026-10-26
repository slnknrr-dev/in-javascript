/* String.prototype.trimStart, String.prototype.trimEnd — ES2019 */
(function () {
  function check(s) { if (s == null) throw new TypeError('String.prototype.trim called on null or undefined'); return String(s); }
  __dg_define(String.prototype, 'trimStart', function () { return check(this).replace(/^\s+/, ''); });
  __dg_define(String.prototype, 'trimEnd', function () { return check(this).replace(/\s+$/, ''); });
})();
