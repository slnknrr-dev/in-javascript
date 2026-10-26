/* ══════════════════════════════════════════════════════════════════════════
   regexp.js — понижение самой регулярки: флаг `u` и `\p{…}`

   Две разные задачи, и цель выбирает, какая из них нужна:

     ES2015…ES2017 (флаг `u` есть, `\p{…}` нет)
       свойства разворачиваются в диапазоны, `u` остаётся — астральные
       кодовые точки так и пишутся `\u{…}`;

     ES5 и ES3 (нет ни того, ни другого)
       свойства разворачиваются, `u` снимается, а всё, что было кодовой
       точкой, становится парой суррогатов: `[\u{1F600}-\u{1F64F}]` →
       `(?:\uD83D[\uDE00-\uDE4F])`.

   Почему пара суррогатов — это честно. Без `u` движок идёт по кодовым
   единицам UTF-16, и астральный символ для него — два кода подряд.
   Альтернатива с парой ставится **перед** BMP-вариантом: жадный выбор
   съест пару целиком, а не одну её половину.

   Таблица свойств вшита в инструмент (downgrade-unicode-props.json, её
   делает downgrade-gen-unicode.js) — иначе результат зависел бы от версии
   Unicode у того node, который запустил сборку.

   Чего не делается — отказ с причиной, а не тихая замена:

     · `i` вместе с `u` на непустом не-ASCII: Unicode-регистр складывает
       буквы иначе, чем ES5 (`K` и `k`), и это не воспроизвести;
     · свойство, которого нет в таблице: видно имя, видно чем дополнить.

   Одно отличие остаётся и описано в §6.7f: одинокий хвостовой суррогат
   (обломок пары в неправильной строке) режим `u` считает кодовой точкой
   и в отрицательный класс берёт, а понижённая регулярка — нет. Одинокий
   ведущий разбирается верно: у него есть проверка «а дальше не хвост».
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';

const TABLE = JSON.parse(readFileSync(new URL('./downgrade-unicode-props.json', import.meta.url), 'utf8'));
const BS = String.fromCharCode(92);
const MAX = 0x10FFFF;

export class RegexpError extends Error {
  constructor(kind, message) { super(message); this.name = 'RegexpError'; this.kind = kind; }
}

/* ── множества кодовых точек: массив [низ, верх], без пересечений ────────── */

export function normalize(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

export function invert(ranges) {
  const out = [];
  let next = 0;
  for (const [lo, hi] of normalize(ranges)) {
    if (lo > next) out.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next <= MAX) out.push([next, MAX]);
  return out;
}

const intersect = (a, b) => {
  const out = [];
  for (const [lo, hi] of normalize(a))
    for (const [lo2, hi2] of normalize(b)) {
      const l = Math.max(lo, lo2), h = Math.min(hi, hi2);
      if (l <= h) out.push([l, h]);
    }
  return normalize(out);
};

const without = (a, b) => intersect(a, invert(b));

const split = ranges => {
  const bmp = [], astral = [];
  for (const [lo, hi] of ranges) {
    if (hi <= 0xFFFF) bmp.push([lo, hi]);
    else if (lo > 0xFFFF) astral.push([lo, hi]);
    else { bmp.push([lo, 0xFFFF]); astral.push([0x10000, hi]); }
  }
  return { bmp, astral };
};

/* ── свойства Unicode ───────────────────────────────────────────────────── */

const decoded = new Map();

export function propertyRanges(name) {
  if (decoded.has(name)) return decoded.get(name);
  const raw = TABLE.props[name] ?? TABLE.props[ALIASES[name]];
  if (raw === undefined)
    throw new RegexpError('unsupported',
      `свойство \`${name}\` не вшито в таблицу Unicode; добавить — в PROPS файла downgrade-gen-unicode.js`);
  const out = [];
  let prev = 0;
  if (raw) for (const item of raw.split(' ')) {
    const [gap, len] = item.split('.');
    const lo = prev + parseInt(gap, 36);
    const hi = lo + parseInt(len, 36);
    out.push([lo, hi]);
    prev = hi + 1;
  }
  decoded.set(name, out);
  return out;
}

/* длинные имена общих категорий — к коротким, как в таблице */
const ALIASES = {
  Letter: 'L', Uppercase_Letter: 'Lu', Lowercase_Letter: 'Ll', Titlecase_Letter: 'Lt',
  Modifier_Letter: 'Lm', Other_Letter: 'Lo', Mark: 'M', Combining_Mark: 'M',
  Nonspacing_Mark: 'Mn', Spacing_Mark: 'Mc', Enclosing_Mark: 'Me',
  Number: 'N', Decimal_Number: 'Nd', digit: 'Nd', Letter_Number: 'Nl', Other_Number: 'No',
  Punctuation: 'P', punct: 'P', Symbol: 'S', Separator: 'Z', Space_Separator: 'Zs',
  Line_Separator: 'Zl', Paragraph_Separator: 'Zp', Other: 'C', Control: 'Cc', cntrl: 'Cc',
  Format: 'Cf', Private_Use: 'Co', Surrogate: 'Cs', Unassigned: 'Cn',
  alpha: 'Alphabetic', space: 'White_Space', lower: 'Lowercase', upper: 'Uppercase',
  General_Category: null,
};

/* `\p{Имя}` или `\p{General_Category=Имя}` */
function propertyOf(body) {
  const eq = body.indexOf('=');
  if (eq < 0) return propertyRanges(body);
  const key = body.slice(0, eq), value = body.slice(eq + 1);
  if (key !== 'General_Category' && key !== 'gc')
    throw new RegexpError('unsupported', `свойство \`${key}=…\` не разворачивается: в таблице только General_Category`);
  return propertyRanges(value);
}

/* ── печать ─────────────────────────────────────────────────────────────── */

const hex4 = n => BS + 'u' + n.toString(16).toUpperCase().padStart(4, '0');
const hexU = n => BS + 'u{' + n.toString(16).toUpperCase() + '}';

const lead = cp => 0xD800 + ((cp - 0x10000) >> 10);
const trail = cp => 0xDC00 + ((cp - 0x10000) & 0x3FF);

/* [низ, верх] BMP → содержимое класса */
const bmpBody = ranges => ranges.map(([lo, hi]) =>
  lo === hi ? hex4(lo) : hex4(lo) + '-' + hex4(hi)).join('');

const anyBody = (ranges, u) => ranges.map(([lo, hi]) => {
  const one = u ? hexU : hex4;
  return lo === hi ? one(lo) : one(lo) + '-' + one(hi);
}).join('');

/* Астральные диапазоны → альтернативы из пар суррогатов.
   Диапазон разбивается по ведущему суррогату: у краёв — свой кусок
   хвостов, в середине — полные хвосты; соседи с одинаковым хвостом
   склеиваются в диапазон ведущих. */
export function surrogatePairs(ranges) {
  const parts = [];                       // [ведущий низ, ведущий верх, хвост низ, хвост верх]
  const add = (l1, l2, t1, t2) => {
    const last = parts[parts.length - 1];
    if (last && last[2] === t1 && last[3] === t2 && last[1] + 1 === l1) last[1] = l2;
    else parts.push([l1, l2, t1, t2]);
  };
  for (const [lo, hi] of ranges) {
    const l1 = lead(lo), l2 = lead(hi);
    if (l1 === l2) { add(l1, l1, trail(lo), trail(hi)); continue; }
    add(l1, l1, trail(lo), 0xDFFF);
    if (l2 - l1 > 1) add(l1 + 1, l2 - 1, 0xDC00, 0xDFFF);
    add(l2, l2, 0xDC00, trail(hi));
  }
  return parts.map(([l1, l2, t1, t2]) => {
    const head = l1 === l2 ? hex4(l1) : '[' + hex4(l1) + '-' + hex4(l2) + ']';
    const tail = t1 === t2 ? hex4(t1) : '[' + hex4(t1) + '-' + hex4(t2) + ']';
    return head + tail;
  });
}

/* Множество кодовых точек → кусок регулярки.
   keepUnicode — цель понимает флаг `u`, астральное пишется `\u{…}`. */
export function printSet(ranges, { negated = false, keepUnicode = false } = {}) {
  let set = normalize(ranges);
  if (negated) set = invert(set);
  if (!set.length) return '[^' + BS + 's' + BS + 'S]';        // пустое множество
  if (keepUnicode) return '[' + anyBody(set, true) + ']';

  const { bmp, astral } = split(set);
  /* Половинки пары из класса убираются: иначе при возврате движок съел бы
     астральный символ как два обычных, и `.{2}` совпало бы с одним эмодзи.
     Ведущий возвращается отдельной альтернативой с проверкой «дальше не
     хвост» — одинокий ведущий так разбирается верно. Одинокий хвостовой
     остаётся единственным отличием (§6.7f). */
  const leads = intersect(bmp, [[0xD800, 0xDBFF]]);
  const plain = without(bmp, [[0xD800, 0xDFFF]]);
  /* ни астрала, ни суррогатов — обычный класс, как было */
  if (!astral.length && !leads.length && plain.length === bmp.length) return '[' + bmpBody(bmp) + ']';

  const alts = surrogatePairs(astral);
  /* Ведущий суррогат сам по себе — только если за ним не идёт хвостовой:
     иначе он половина пары, и в режиме u его бы не взяли отдельно. Пара
     проверяется первой, поэтому целый символ уходит целиком. */
  if (leads.length) alts.push('[' + bmpBody(leads) + '](?![' + hex4(0xDC00) + '-' + hex4(0xDFFF) + '])');
  if (plain.length) alts.push('[' + bmpBody(plain) + ']');
  if (!alts.length) return '[^' + BS + 's' + BS + 'S]';
  /* Группа нужна всегда, даже на одной альтернативе: пара суррогатов —
     это два атома, и квантификатор без группы прилип бы к последнему
     (эмодзи с + совпадал бы как один ведущий и много хвостовых). */
  return '(?:' + alts.join('|') + ')';
}

/* ── разбор шаблона ─────────────────────────────────────────────────────── */

const CLASS_SHORTHAND = {
  d: [[0x30, 0x39]],
  s: [[0x09, 0x0D], [0x20, 0x20], [0xA0, 0xA0], [0x1680, 0x1680], [0x2000, 0x200A],
      [0x2028, 0x2029], [0x202F, 0x202F], [0x205F, 0x205F], [0x3000, 0x3000], [0xFEFF, 0xFEFF]],
  w: [[0x30, 0x39], [0x41, 0x5A], [0x5F, 0x5F], [0x61, 0x7A]],
};

/* `.` в режиме `u`: любая кодовая точка, кроме переводов строки */
const DOT_RANGES = invert([[0x0A, 0x0A], [0x0D, 0x0D], [0x2028, 0x2029]]);

class Reader {
  constructor(src) { this.src = src; this.i = 0; }
  get done() { return this.i >= this.src.length; }
  peek(k = 0) { return this.src[this.i + k]; }
  next() { return this.src[this.i++]; }
  /* кодовая точка целиком: суррогатная пара — один символ */
  nextCodePoint() {
    const cp = this.src.codePointAt(this.i);
    this.i += cp > 0xFFFF ? 2 : 1;
    return cp;
  }
}

/* Escape внутри шаблона: возвращает либо множество (класс), либо саму
   кодовую точку, либо «оставить как есть» (границы, ссылки, якоря). */
const nonAscii = set => set.some(([, hi]) => hi > 0x7F);

function readEscape(r, { inClass, state }) {
  const c = r.next();
  if (c === 'p' || c === 'P') {
    if (r.peek() !== '{') throw new RegexpError('unsupported', BS + c + ' без `{…}` в режиме u недопустим');
    const end = r.src.indexOf('}', r.i);
    if (end < 0) throw new RegexpError('unsupported', 'незакрытая `' + BS + c + '{`');
    const body = r.src.slice(r.i + 1, end);
    r.i = end + 1;
    const set = propertyOf(body);
    if (state) state.fold = true;
    return { set: c === 'P' ? invert(set) : set };
  }
  if (c === 'u') {
    if (r.peek() === '{') {
      const end = r.src.indexOf('}', r.i);
      const cp = parseInt(r.src.slice(r.i + 1, end), 16);
      r.i = end + 1;
      return { cp };
    }
    const cp = parseInt(r.src.substr(r.i, 4), 16);
    r.i += 4;
    return { cp };
  }
  if (c === 'x') { const cp = parseInt(r.src.substr(r.i, 2), 16); r.i += 2; return { cp }; }
  if (c === 'c' && /[A-Za-z]/.test(r.peek() ?? '')) { const cp = r.next().toUpperCase().charCodeAt(0) - 64; return { cp }; }
  if (CLASS_SHORTHAND[c]) { if (state) state.fold = true; return { set: CLASS_SHORTHAND[c] }; }
  if (c === 'D' || c === 'S' || c === 'W') {
    if (state) state.fold = true;
    return { set: invert(CLASS_SHORTHAND[c.toLowerCase()]) };
  }
  if ('0' === c) return { cp: 0 };
  if ('nrtfv'.includes(c)) return { cp: { n: 10, r: 13, t: 9, f: 12, v: 11 }[c] };
  if (!inClass && /[bB1-9kq]/.test(c)) return { keep: BS + c };   // границы и обратные ссылки
  if (c === 'b' && inClass) return { cp: 8 };
  return { cp: c.codePointAt(0) };                                 // экранированный символ
}

/* Содержимое `[...]` → множество кодовых точек. Курсор стоит после `[`. */
function readClass(r, state) {
  let negated = false;
  if (r.peek() === '^') { r.next(); negated = true; }
  const set = [];
  while (!r.done && r.peek() !== ']') {
    const item = r.peek() === BS ? (r.next(), readEscape(r, { inClass: true, state })) : { cp: r.nextCodePoint() };
    if (item.set) { set.push(...item.set); if (state && nonAscii(item.set)) state.fold = true; continue; }
    /* диапазон `a-z`, но не `a-\d` и не хвостовой `-` */
    if (r.peek() === '-' && r.peek(1) !== ']' && r.peek(1) !== undefined) {
      r.next();
      const to = r.peek() === BS ? (r.next(), readEscape(r, { inClass: true, state })) : { cp: r.nextCodePoint() };
      if (to.set) { set.push([item.cp, item.cp], ...to.set, [0x2D, 0x2D]); continue; }
      set.push([item.cp, to.cp]);
      if (state && to.cp > 0x7F) state.fold = true;
      continue;
    }
    set.push([item.cp, item.cp]);
    if (state && item.cp > 0x7F) state.fold = true;
  }
  if (r.done) throw new RegexpError('unsupported', 'незакрытый класс `[`');
  r.next();                                                        // ']'
  return { set: normalize(set), negated };
}

/* Понизить шаблон. keepUnicode — оставить флаг `u` (цель его понимает,
   но не понимает `\p{…}`). Возвращает новый текст шаблона. */
/* Номера групп по именам: `(?<year>…)` — третья по счёту скобка, значит
   ссылка на неё по имени станет ссылкой на номер 3. Считаются только
   настоящие группы: `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!` ими не являются. */
export function groupNumbers(pattern) {
  const names = new Map();
  let n = 0, inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === BS) { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c !== '(') continue;
    if (pattern[i + 1] !== '?') { n++; continue; }
    const m = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(pattern.slice(i));
    if (m) { n++; names.set(m[1], n); }
  }
  return names;
}

/* Снять имена групп, не трогая больше ничего: `(?<year>` → `(`, а ссылка
   по имени — ссылкой на номер. Номера при этом не меняются. */
export function stripNames(pattern) {
  const names = groupNumbers(pattern);
  let out = '', inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === BS) {
      const m = /^\\k<([^>]*)>/.exec(pattern.slice(i));
      if (m && !inClass) {
        if (!names.has(m[1])) throw new RegexpError('unsupported', 'ссылка на группу `' + m[1] + '`, которой нет');
        out += BS + names.get(m[1]);
        i += m[0].length - 1;
        continue;
      }
      out += c + (pattern[i + 1] ?? '');
      i++;
      continue;
    }
    if (inClass) { if (c === ']') inClass = false; out += c; continue; }
    if (c === '[') { inClass = true; out += c; continue; }
    const g = c === '(' && /^\(\?<(?![=!])[^>]*>/.exec(pattern.slice(i));
    if (g) { out += '('; i += g[0].length - 1; continue; }
    out += c;
  }
  return out;
}

export function lowerPattern(pattern, flags, { keepUnicode = false, hoist = t => t, dropNames = false } = {}) {
  /* `i` вместе с `u` складывает регистр по Unicode: `K` (знак Кельвина)
     совпадает с `k`, `ſ` — с `s`. В ES5 этого нет, и подделать нечем.
     Отказ нужен, только если в шаблоне вообще есть не-ASCII: чистая
     латиница складывается одинаково. Точка сюда не считается — она
     совпадает с чем угодно и от регистра не зависит. */
  /* Разбирать и печатать заново нужно, только когда это правда меняет
     шаблон: без режима `u` классы и так значат что надо, а с `u` у цели,
     которая его понимает, — всё, кроме свойств. Иначе достаточно снять
     имена групп, а остальной текст остаётся байт в байт. */
  const unicode = flags.includes('u') || flags.includes('v');
  const rewriteSets = unicode && (!keepUnicode || /\\[pP]\{/.test(pattern));
  if (!rewriteSets) return dropNames ? stripNames(pattern) : pattern;

  const state = { fold: false };
  const names = dropNames ? groupNumbers(pattern) : null;
  const r = new Reader(pattern);
  let out = '';
  while (!r.done) {
    const c = r.peek();
    if (c === BS) {
      const start = r.i;
      r.next();
      const item = readEscape(r, { inClass: false, state });
      /* ссылка на группу по имени → ссылка на её номер */
      if (dropNames && item.keep === BS + 'k' && r.peek() === '<') {
        const end = r.src.indexOf('>', r.i);
        const name = r.src.slice(r.i + 1, end);
        if (!names.has(name)) throw new RegexpError('unsupported', 'ссылка на группу `' + name + '`, которой нет');
        r.i = end + 1;
        out += BS + names.get(name);
        continue;
      }
      if (item.keep) { out += item.keep; continue; }
      if (item.set) { out += hoist(printSet(item.set, { keepUnicode })); continue; }
      if (item.cp > 0x7F) state.fold = true;
      /* кодовую точку оставляем как была, если запись уже годится цели */
      if (item.cp > 0xFFFF && !keepUnicode) out += hex4(lead(item.cp)) + hex4(trail(item.cp));
      else if (pattern.slice(start, r.i).includes('{') && !keepUnicode) out += hex4(item.cp);
      else out += pattern.slice(start, r.i);
      continue;
    }
    /* именованная группа → обычная: номер у неё тот же */
    if (dropNames && c === '(' && r.src.startsWith('(?<', r.i) &&
        !r.src.startsWith('(?<=', r.i) && !r.src.startsWith('(?<!', r.i)) {
      r.i = r.src.indexOf('>', r.i) + 1;
      out += '(';
      continue;
    }
    if (c === '[') { r.next(); const { set, negated } = readClass(r, state); out += hoist(printSet(set, { negated, keepUnicode })); continue; }
    if (c === '.' && !keepUnicode) { r.next(); out += hoist(printSet(DOT_RANGES)); continue; }
    const cp = r.nextCodePoint();
    if (cp > 0x7F) state.fold = true;
    if (cp > 0xFFFF && !keepUnicode) out += '(?:' + hex4(lead(cp)) + hex4(trail(cp)) + ')';
    else out += String.fromCodePoint(cp);
  }
  if (state.fold && flags.includes('i') && !keepUnicode)
    throw new RegexpError('unsupported',
      'флаги `iu` вместе: Unicode-регистр складывает символы не так, как ES5');
  return out;
}

/* Флаги без того, что цель не понимает. */
export const lowerFlags = (flags, { keepUnicode }) =>
  keepUnicode ? flags : flags.split('').filter(f => f !== 'u').join('');
