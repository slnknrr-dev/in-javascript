/* String.prototype.padStart, String.prototype.padEnd — ES2017 */
(function () {
  function pad(self, maxLength, fillString, atStart) {
    if (self == null) throw new TypeError('String.prototype.pad called on null or undefined');
    var s = String(self), target = __dg_toInt(maxLength);
    if (target <= s.length) return s;
    var filler = fillString === undefined ? ' ' : String(fillString);
    if (filler === '') return s;
    var need = target - s.length, fill = filler;
    while (fill.length < need) fill += fill;               /* удвоением: O(log n) */
    fill = fill.slice(0, need);
    return atStart ? fill + s : s + fill;
  }
  __dg_define(String.prototype, 'padStart', function (maxLength, fillString) { return pad(this, maxLength, fillString, true); });
  __dg_define(String.prototype, 'padEnd', function (maxLength, fillString) { return pad(this, maxLength, fillString, false); });
})();
