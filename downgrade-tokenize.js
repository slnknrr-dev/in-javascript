/* ══════════════════════════════════════════════════════════════════════════
   tokenize.js — сканер JS/TS до уровня токенов

   Первая половина будущего парсера и весь фундамент минификатора: чтобы
   выкинуть комментарий, надо уметь отличить его от косой черты внутри
   строки, шаблона или регулярного выражения.

   Выдаёт плоский список токенов:

     { t, v, nl, s, e }
       t     punct | name | num | str | tmpl | regexp | priv
       v     исходный текст токена, байт в байт
       nl    между предыдущим токеном и этим был перевод строки
             (в пробелах ИЛИ внутри выброшенного комментария)
       s, e  смещения в исходнике: src.slice(s, e) === v

   Смещения нужны линкеру: он вырезает import/export-операторы прямо из
   текста, а не пересобирает файл из токенов, — иначе пропали бы все
   комментарии, ради которых обычный (не .min) артефакт и существует.

   Поле nl — не косметика: от наличия перевода строки между токенами
   зависит ASI, поэтому минификатор обязан его сохранить.

   Регулярку от деления отличаем по предыдущему значимому токену — та же
   эвристика, что у всех однопроходных сканеров. Она врёт на `if (x) /re/…`
   и `{}/re/`, где нужен разбор выражения; такой код здесь не встречается,
   а если встретится — соврёт заметно (см. verify в minify.js).
   ══════════════════════════════════════════════════════════════════════════ */

/* после этих слов «/» — начало регулярного выражения, а не деление */
const REGEXP_OK_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await', 'if', 'while', 'for',
  'default', 'extends',
]);

/* пунктуаторы, от длинных к коротким */
const PUNCT = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=',
  '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%',
  '&', '|', '^', '!', '~', '?', ':', '=', '.', '@', '#',
];

const isIdStart = c => /[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 0x7F;
const isIdPart = c => /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 0x7F;
const isDigit = c => c >= '0' && c <= '9';
const isNl = c => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';

class SyntaxErrorAt extends Error {
  constructor(msg, src, i) {
    let line = 1;
    for (let k = 0; k < i && k < src.length; k++) if (src[k] === '\n') line++;
    super(`${msg} (строка ${line})`);
    this.name = 'SyntaxErrorAt';
    this.line = line;
  }
}

/* «/» здесь начинает регулярное выражение? */
function regexpAllowed(prev) {
  if (!prev) return true;
  if (prev.t === 'num' || prev.t === 'str' || prev.t === 'tmpl' ||
      prev.t === 'regexp' || prev.t === 'priv') return false;
  if (prev.t === 'name') return REGEXP_OK_WORDS.has(prev.v);
  /* пунктуатор: после закрывающих — деление, после остальных — регулярка.
     `)` и `}` неоднозначны; выбираем деление (частый случай). */
  return !(prev.v === ')' || prev.v === ']' || prev.v === '}' ||
           prev.v === '++' || prev.v === '--');
}

/* Строка не может пересечь перевод строки — но только LF и CR: U+2028 и
   U+2029 внутри строкового литерала законны с ES2019 (JSON superset). */
function readString(src, i) {
  const q = src[i];
  let p = i + 1;
  while (p < src.length) {
    const c = src[p];
    if (c === '\\') { p += 2; continue; }
    if (c === q) return p + 1;
    if (c === '\n' || c === '\r') throw new SyntaxErrorAt('строка не закрыта до конца строки', src, i);
    p++;
  }
  throw new SyntaxErrorAt('строка не закрыта', src, i);
}

/* шаблон целиком, вместе с вложенными ${…} и вложенными шаблонами */
function readTemplate(src, i) {
  let p = i + 1, depth = 0;
  while (p < src.length) {
    const c = src[p];
    if (c === '\\') { p += 2; continue; }
    if (depth === 0 && c === '`') return p + 1;
    if (depth === 0 && c === '$' && src[p + 1] === '{') { depth++; p += 2; continue; }
    if (depth > 0) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '`') { p = readTemplate(src, p); continue; }
      else if (c === '"' || c === "'") { p = readString(src, p); continue; }
      else if (c === '/' && src[p + 1] === '/') { while (p < src.length && !isNl(src[p])) p++; continue; }
      else if (c === '/' && src[p + 1] === '*') {
        const e = src.indexOf('*/', p + 2);
        if (e < 0) throw new SyntaxErrorAt('комментарий не закрыт', src, p);
        p = e + 2; continue;
      }
    }
    p++;
  }
  throw new SyntaxErrorAt('шаблонная строка не закрыта', src, i);
}

function readRegexp(src, i) {
  let p = i + 1, inClass = false;
  while (p < src.length) {
    const c = src[p];
    if (c === '\\') { p += 2; continue; }
    if (isNl(c)) throw new SyntaxErrorAt('регулярное выражение не закрыто', src, i);
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) { p++; break; }
    p++;
  }
  while (p < src.length && isIdPart(src[p])) p++;      // флаги
  return p;
}

function readNumber(src, i) {
  let p = i;
  if (src[p] === '0' && /[xXoObB]/.test(src[p + 1] || '')) {
    p += 2;
    while (p < src.length && /[0-9a-fA-F_]/.test(src[p])) p++;
  } else {
    while (p < src.length && (isDigit(src[p]) || src[p] === '_')) p++;
    if (src[p] === '.') { p++; while (p < src.length && (isDigit(src[p]) || src[p] === '_')) p++; }
    if (/[eE]/.test(src[p] || '')) {
      p++;
      if (src[p] === '+' || src[p] === '-') p++;
      while (p < src.length && isDigit(src[p])) p++;
    }
  }
  if (src[p] === 'n') p++;                              // BigInt
  return p;
}

/* Исходный текст → список токенов. Комментарии выброшены, но их переводы
   строк учтены в nl.

   from/to ограничивают разбор куском файла, не сдвигая смещения: парсеру
   нужно разобрать выражение внутри ${…} шаблонной строки, а позиции узлов
   обязаны остаться абсолютными — по ним потом режется текст. */
export function tokenize(src, { from = 0, to = src.length } = {}) {
  const out = [];
  let i = from, nl = false;

  /* BOM и шебанг — только если читаем файл с начала */
  if (from === 0) {
    if (src.charCodeAt(0) === 0xFEFF) i = 1;
    if (src[i] === '#' && src[i + 1] === '!') { while (i < to && !isNl(src[i])) i++; }
  }

  while (i < to) {
    const c = src[i];

    if (isNl(c)) { nl = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === '\u00A0') { i++; continue; }

    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && !isNl(src[i])) i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) throw new SyntaxErrorAt('комментарий не закрыт', src, i);
      for (let k = i; k < e; k++) if (isNl(src[k])) { nl = true; break; }
      i = e + 2;
      continue;
    }

    const push = (t, end) => { out.push({ t, v: src.slice(i, end), nl, s: i, e: end }); nl = false; i = end; };

    if (c === '"' || c === "'") { push('str', readString(src, i)); continue; }
    if (c === '`') { push('tmpl', readTemplate(src, i)); continue; }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) { push('num', readNumber(src, i)); continue; }
    if (c === '#' && isIdStart(src[i + 1] || ' ')) {
      let p = i + 1;
      while (p < src.length && isIdPart(src[p])) p++;
      push('priv', p);
      continue;
    }
    if (isIdStart(c)) {
      let p = i;
      while (p < src.length && isIdPart(src[p])) p++;
      push('name', p);
      continue;
    }
    if (c === '/' && regexpAllowed(out[out.length - 1])) { push('regexp', readRegexp(src, i)); continue; }

    const p = PUNCT.find(op => src.startsWith(op, i));
    if (!p) throw new SyntaxErrorAt(`неизвестный символ ${JSON.stringify(c)}`, src, i);
    push('punct', i + p.length);
  }

  return out;
}

/* Шаблонная строка — один токен, потому что минификатору она нужна целиком.
   Парсеру наоборот нужны её части, поэтому разбор вынесен отдельно.

   Возвращает куски текста между подстановками и диапазоны самих выражений,
   в абсолютных смещениях:

     `a${x}b`  →  quasis [a][b],  exprs [x]

   Границы кусков — без обрамляющих символов: quasi это то, что между
   backtick/`}` и `${`/backtick, expr — то, что внутри ${…}. */
export function splitTemplate(src, start, end) {
  const quasis = [], exprs = [];
  let p = start + 1, qStart = p;

  while (p < end - 1) {
    const c = src[p];
    if (c === '\\') { p += 2; continue; }

    if (c === '$' && src[p + 1] === '{') {
      quasis.push({ start: qStart, end: p, tail: false });
      const eStart = p + 2;
      p = skipSubstitution(src, eStart, end);
      exprs.push({ start: eStart, end: p });
      p++;                                   // закрывающая }
      qStart = p;
      continue;
    }
    p++;
  }

  quasis.push({ start: qStart, end: end - 1, tail: true });
  return { quasis, exprs };
}

/* Позиция закрывающей `}` подстановки: считаем скобки, пропуская строки,
   вложенные шаблоны и комментарии. */
function skipSubstitution(src, from, end) {
  let p = from, depth = 0;
  while (p < end) {
    const c = src[p];
    if (c === '\\') { p += 2; continue; }
    if (c === '}' && depth === 0) return p;
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '`') { p = readTemplate(src, p); continue; }
    else if (c === '"' || c === "'") { p = readString(src, p); continue; }
    else if (c === '/' && src[p + 1] === '/') { while (p < end && !isNl(src[p])) p++; continue; }
    else if (c === '/' && src[p + 1] === '*') {
      const e = src.indexOf('*/', p + 2);
      if (e < 0) throw new SyntaxErrorAt('комментарий не закрыт', src, p);
      p = e + 2; continue;
    }
    p++;
  }
  throw new SyntaxErrorAt('подстановка ${…} не закрыта', src, from);
}

export { SyntaxErrorAt };
