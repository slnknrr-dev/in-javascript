/* ══════════════════════════════════════════════════════════════════════════
   lower.js — понижение слинкованного кода до уровня цели (M3)

     lower(code, profile) → { code, passes, helpers, shims }

   Порядок:

     1. разобрать и найти всё, чего цель не умеет (features.js);
     2. если среди этого есть непонижаемое — отказ `unsupported`, если
        понижаемое, но проход ещё не написан, — отказ `pending`. Отказ не
        ошибка сборки: цель просто не собирается, причина — в отчёт;
     3. проходы — от новых возможностей к старым: ES2022 раньше ES2016,
        потому что понижение нового порождает старое (`??=` → `??`), а не
        наоборот. После каждого прохода текст разбирается заново;
     4. runtime-примитивы, которых у цели нет, — шимы (runtime.js);
     5. проверка результата: тот же детектор по готовому тексту. Если
        что-то новее цели осталось — это ошибка прохода, и сборка падает
        громко, а не кладёт на диск артефакт, который не загрузится.

   Вспомогательные функции (`__dg_objectSpread` и т. п.), шимы и временные
   переменные верхнего уровня собираются в runtime-блок, который встаёт
   на место метки, оставленной линкером, — перед первым модулем.
   ══════════════════════════════════════════════════════════════════════════ */

import { parse } from './downgrade-parse.js';
import { FEATURES, detect } from './downgrade-features.js';
import { supports, esName } from './downgrade-profiles.js';
import { LowerError } from './downgrade-rewrite.js';
import { PASSES } from './downgrade-passes.js';
import { HELPERS } from './downgrade-runtime-helpers.js';
import { runtimeFor, rewriteBuffer } from './downgrade-runtime.js';
import { RUNTIME_SLOT } from './downgrade-link.js';

export { LowerError };

/* Состояние одного понижения: имена вспомогательных функций живут
   дольше одного прохода — второй проход должен звать ту же функцию,
   а не заводить копию. */
class Session {
  constructor(profile) {
    this.profile = profile;
    this.helpers = new Map();        // id → имя в этом файле
    this.consts = new Map();         // текст → имя: длинные куски, вынесенные из кода
    this.temps = [];                 // временные переменные верхнего уровня
  }

  helper(id, info) {
    if (!HELPERS[id]) throw new Error(`нет вспомогательной функции ${id}`);
    if (!this.helpers.has(id)) this.helpers.set(id, info.fresh(id));
    return this.helpers.get(id);
  }

  /* Строковая константа runtime-блока: один и тот же текст получает одно
     имя, сколько бы раз проход его ни попросил. Так развёрнутое `p{L}`
     ложится в артефакт единожды, а не тридцатью копиями. */
  constant(text, hint, info) {
    if (!this.consts.has(text)) this.consts.set(text, info.fresh(hint));
    return this.consts.get(text);
  }
}

const where = (code, pos) => {
  if (pos == null) return '';
  let line = 1;
  for (let i = 0; i < pos && i < code.length; i++) if (code[i] === '\n') line++;
  return ` (строка ${line})`;
};

/* Что в тексте требует понижения для этой цели: Map<id, [узлы]>. */
function needed(ast, code, profile) {
  const out = new Map();
  for (const { id, node } of detect(ast, code)) {
    if (supports(profile, id)) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(node);
  }
  return out;
}

/* Отказ, если среди нужного есть непонижаемое или ещё не написанное.
   Непонижаемое важнее: оно не исправится никаким будущим этапом. */
function refuse(need, code, profile) {
  const blockers = [...need].filter(([id]) => !FEATURES[id].pass);
  if (!blockers.length) return;
  const unsupported = blockers.filter(([id]) => FEATURES[id].unsupported);
  const [id, nodes] = unsupported[0] ?? blockers[0];
  const f = FEATURES[id];
  const level = esName(profile.es);
  if (f.unsupported)
    throw new LowerError('unsupported',
      `${f.title} (ES${f.year}) — ${f.unsupported}${where(code, nodes[0].start)}`, { feature: id, pos: nodes[0].start });
  const others = blockers.filter(([i]) => i !== id).map(([i]) => FEATURES[i].title);
  throw new LowerError('pending',
    `${f.title} → ${level}: проход — этап ${f.pending}${where(code, nodes[0].start)}` +
    (others.length ? `; ещё: ${others.join(', ')}` : ''), { feature: id, pos: nodes[0].start });
}

/* Понизить код до профиля цели. Бросает LowerError (отказ) или Error
   (ошибка прохода — баг инструмента). */
/* ts — в тексте остались типы TypeScript (цель `@ts`): их надо уметь
   разобрать, чтобы не принять за код. */
export function lower(code, profile, { root = process.cwd(), ts = false } = {}) {
  const session = new Session(profile);
  let ast = parse(code, { ts });
  let need = needed(ast, code, profile);
  refuse(need, code, profile);

  const applied = [];
  for (const pass of PASSES) {
    for (let round = 0; pass.features.some(id => need.has(id)); round++) {
      if (round === 8) throw new Error(`проход ${pass.id} не справился за 8 кругов`);
      const r = pass.run(code, ast, { session, profile });
      if (r.code === code) throw new Error(`проход ${pass.id} ничего не изменил, а понижать есть что`);
      code = r.code;
      session.temps.push(...r.programTemps);
      try { ast = parse(code, { ts }); }
      catch (e) { throw new Error(`проход ${pass.id} выдал неразбираемый текст: ${e.message}`); }
      need = needed(ast, code, profile);
      if (!applied.includes(pass.id)) applied.push(pass.id);
    }
  }

  /* проверка: всё, чего цель не умеет, должно было уйти */
  if (need.size) {
    const [id, nodes] = [...need][0];
    throw new Error(`после понижения до ${esName(profile.es)} осталось: ${FEATURES[id].title}` +
      where(code, nodes[0].start));
  }

  /* node-only Buffer.alloc* — переносимой заменой (runtime.js) */
  const portable = rewriteBuffer(code, ast, session, profile);
  if (portable !== code) {
    code = portable;
    ast = parse(code, { ts });
    applied.push('portable-buffer');
  }

  const runtime = runtimeFor(ast, code, profile, session, undefined, root);

  const block = runtimeBlock(session, runtime.blocks, profile);
  code = placeRuntime(code, block, ts);
  if (block) {
    try { parse(code, { ts }); }
    catch (e) { throw new Error(`runtime-блок сломал разбор: ${e.message}`); }
  }

  return {
    code, passes: applied, helpers: [...session.helpers.keys()],
    shims: runtime.blocks.map(s => s.id), snippets: runtime.snippets,
  };
}

/* ── runtime-блок ───────────────────────────────────────────────────────── */

function runtimeBlock(session, shims, profile) {
  const parts = [];
  if (session.temps.length) parts.push(`var ${session.temps.join(', ')};`);
  for (const [text, name] of session.consts) parts.push(`var ${name} = ${JSON.stringify(text)};`);
  for (const [id, name] of session.helpers) parts.push(HELPERS[id](name).trim());
  for (const s of shims) parts.push(s.code.trim());
  if (!parts.length) return '';
  const title = `downgrade runtime → ${profile.target}`;
  return `/* ── ${title} ${'─'.repeat(Math.max(3, 66 - title.length))} */\n\n` +
    parts.join('\n\n') +
    `\n\n/* ── /runtime ${'─'.repeat(59)} */`;
}

/* Поставить runtime-блок на место метки линкера; без метки — в начало
   программы, после директив и импортов. Метка без блока просто
   исчезает вместе со своей пустой строкой — артефакт без runtime
   байт в байт такой же, каким был до появления меток. */
function placeRuntime(code, block, ts = false) {
  const at = code.indexOf(RUNTIME_SLOT);
  if (at >= 0) {
    const end = at + RUNTIME_SLOT.length;
    if (block) return code.slice(0, at) + block + code.slice(end);
    const tail = code.slice(end).replace(/^\n\n/, '');
    return code.slice(0, at) + tail;
  }
  if (!block) return code;
  const ast = parse(code, { ts });
  let pos = 0;
  for (const st of ast.body) {
    const directive = st.type === 'ExpressionStatement' && st.expression.type === 'Literal' &&
      typeof st.expression.value === 'string';
    if (directive || st.type === 'ImportDeclaration') pos = st.end;
    else break;
  }
  return pos === 0 ? block + '\n\n' + code : code.slice(0, pos) + '\n\n' + block + code.slice(pos);
}
