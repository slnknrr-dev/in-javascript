/* RegExp.escape — ES2025, по алгоритму спецификации: синтаксические
   символы и `/` — через обратную косую, управляющие — буквой (t n v f r),
   прочая пунктуация, пробелы и одиночные суррогаты — шестнадцатеричным
   кодом, цифра или латинская буква в самом начале — тоже кодом, чтобы
   не склеиться с тем, что стоит перед вставкой в шаблон. */
__dg_define(RegExp, 'escape', function (s) {
  if (typeof s !== 'string') throw new TypeError('RegExp.escape requires a string');
  var BS = String.fromCharCode(92);
  var SYNTAX = '^$' + BS + '.*+?()[]{}|/', PUNCT = ",-=<>#&!%:;@~'`" + String.fromCharCode(34);
  var CONTROL = { 9: 't', 10: 'n', 11: 'v', 12: 'f', 13: 'r' };
  function hex(c, width) { var h = c.toString(16); while (h.length < width) h = '0' + h; return h; }
  function isSpace(c) {
    return c === 0x20 || c === 0xA0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) ||
      c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF || c === 0x2028 || c === 0x2029;
  }
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i), c = s.charCodeAt(i);
    /* пара суррогатов — одна кодовая точка, выводится как есть */
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) {
      out += ch + s.charAt(i + 1);
      i++;
      continue;
    }
    if (out === '' && ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) out += BS + 'x' + hex(c, 2);
    else if (SYNTAX.indexOf(ch) >= 0) out += BS + ch;
    else if (CONTROL[c]) out += BS + CONTROL[c];
    else if (PUNCT.indexOf(ch) >= 0 || isSpace(c) || (c >= 0xD800 && c <= 0xDFFF))
      out += c <= 0xFF ? BS + 'x' + hex(c, 2) : BS + 'u' + hex(c, 4);
    else out += ch;
  }
  return out;
});
