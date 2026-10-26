/* ══════════════════════════════════════════════════════════════════════════
   walk.js — обход AST

   Обходчик общий: он не знает таблицы «у какого узла какие дети», а просто
   спускается по всем полям-объектам. Так он не устаревает, когда в парсере
   появляется новый тип узла, — а таблица устаревала бы молча, и проход
   понижения тихо пропускал бы часть дерева.

   Плата — обход полей, детьми не являющихся (`value` у Literal, `regex`,
   `value` у TemplateElement). Они отсеиваются по отсутствию `type`.

     walk(root, { enter, leave })   обойти всё
     collect(root, type)            все узлы такого типа
     find(root, predicate)          первый подходящий
     parentsOf(root)                Map: узел → родитель

   enter может вернуть false — тогда поддерево не обходится.
   ══════════════════════════════════════════════════════════════════════════ */

const isNode = v => v !== null && typeof v === 'object' && typeof v.type === 'string';

/* Поля, которые заведомо не содержат узлов, — только ради скорости:
   значения без `type` отсеиваются и так.

   Поля `expression` здесь нет, хотя у стрелки это булев флаг: у
   ExpressionStatement и ChainExpression это ребёнок-узел. Когда оно
   стояло в списке, обходчик молча не заходил внутрь операторов-выражений,
   и всё, что стояло на walk, — проверки диапазонов, сбор узлов, —
   не видело добрую половину кода. */
const SKIP = new Set(['type', 'start', 'end', 'raw', 'name', 'operator', 'kind',
  'computed', 'optional', 'static', 'method', 'shorthand', 'prefix', 'delegate',
  'generator', 'async', 'tail', 'sourceType', 'parenthesized',
  'regex', 'bigint']);

export function walk(root, { enter, leave } = {}) {
  (function visit(node, parent, key, index) {
    if (enter && enter(node, parent, key, index) === false) return;

    for (const field of Object.keys(node)) {
      if (SKIP.has(field)) continue;
      const v = node[field];
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) if (isNode(v[i])) visit(v[i], node, field, i);
      } else if (isNode(v)) visit(v, node, field, null);
    }

    if (leave) leave(node, parent, key, index);
  })(root, null, null, null);
}

export function collect(root, type) {
  const out = [];
  walk(root, { enter: n => { if (n.type === type) out.push(n); } });
  return out;
}

export function find(root, predicate) {
  let hit = null;
  walk(root, { enter: n => { if (!hit && predicate(n)) hit = n; } });
  return hit;
}

export function parentsOf(root) {
  const parents = new Map();
  walk(root, { enter: (n, p) => { parents.set(n, p); } });
  return parents;
}

/* Структурный отпечаток: дерево типов и значащих полей, без позиций.

   Нужен, чтобы сравнивать два AST, полученных из по-разному отформатированного
   одного и того же кода. Если исходник и его минифицированная версия дают
   разные отпечатки, соврал либо парсер, либо минификатор. */
export function fingerprint(node) {
  if (Array.isArray(node)) return '[' + node.map(fingerprint).join(',') + ']';
  if (!isNode(node)) return node === undefined ? 'u' : JSON.stringify(node) ?? 'null';

  const parts = [node.type];
  for (const field of Object.keys(node).sort()) {
    if (field === 'type' || field === 'start' || field === 'end' ||
        field === 'parenthesized' || field === 'raw') continue;
    parts.push(field + ':' + fingerprint(node[field]));
  }
  return '(' + parts.join(' ') + ')';
}

export { isNode };
