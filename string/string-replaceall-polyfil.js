/* String.prototype.replaceAll — ES2021

   Строка поиска превращается в глобальную регулярку из экранированного
   текста: групп в ней нет, так что $1 в замене остаётся буквальным, а
   функция замены получает (совпадение, позиция, строка) — как у
   настоящего replaceAll. */
__dg_define(String.prototype, 'replaceAll', function (search, replacement) {
  if (this == null) throw new TypeError('String.prototype.replaceAll called on null or undefined');
  if (search != null && Object.prototype.toString.call(search) === '[object RegExp]') {
    var flags = 'flags' in search ? String(search.flags) : (search.global ? 'g' : '');
    if (flags.indexOf('g') < 0) throw new TypeError('replaceAll must be called with a global RegExp');
    return String(this).replace(search, replacement);
  }
  var s = String(this);
  var BS = String.fromCharCode(92);
  var re = new RegExp(String(search).replace(/[\\^$.*+?()[\]{}|/]/g, BS + '$&'), 'g');
  return s.replace(re, typeof replacement === 'function'
    ? function (m, offset) { return String(replacement(m, offset, s)); }
    : String(replacement));
});
