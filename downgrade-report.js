/* ══════════════════════════════════════════════════════════════════════════
   report.js — отчёт о сборке для CI

   То же, что `emit` печатает в терминал, но в файл и в машинном виде:

     --report=build.json   JSON: по записи на каждую пару (исходник × цель)
     --report=build.md     Markdown: сводка для страницы задания в Forgejo

   Markdown пишется так, чтобы его можно было дописать в
   `$GITHUB_STEP_SUMMARY` как есть: заголовок, табличка по целям и списки
   того, что не собралось, — с причиной у каждой строки. Причина важнее
   числа: «не собралось 26» ничего не говорит, а «BigInt не выражается
   через Number» говорит всё.
   ══════════════════════════════════════════════════════════════════════════ */

const KINDS = [
  ['written', 'записано'],
  ['skipped', 'без изменений'],
  ['mismatched', 'расхождения'],
  ['drifted', 'отстали комментарии'],
  ['pruned', 'удалено'],
  ['failed', 'отказы инструмента'],
  ['pending', 'ждут прохода'],
  ['unsupported', 'не понижаются'],
];

/* строки отчёта: { kind, file, target, why } */
export function rows(r) {
  const out = [];
  for (const [key] of KINDS)
    for (const item of r[key] ?? []) {
      if (typeof item === 'string') { out.push({ kind: key, path: item }); continue; }
      out.push({ kind: key, file: item.file, target: item.target, why: item.why ?? null });
    }
  return out;
}

export function toJson(r, extra = {}) {
  const counts = Object.fromEntries(KINDS.map(([key]) => [key, (r[key] ?? []).length]));
  return JSON.stringify({ ...extra, counts, rows: rows(r) }, null, 1) + '\n';
}

export function toMarkdown(r, { title = 'downgrade', root = '' } = {}) {
  const all = rows(r);
  const counts = Object.fromEntries(KINDS.map(([key, name]) => [name, (r[key] ?? []).length]));
  const lines = [`## ${title}`, ''];

  lines.push('| что | сколько |', '|---|---:|');
  for (const [name, n] of Object.entries(counts)) if (n) lines.push(`| ${name} | ${n} |`);
  if (!all.length) lines.push('| — | 0 |');
  lines.push('');

  /* по целям: сколько собралось и сколько нет */
  const byTarget = new Map();
  for (const row of all) {
    if (!row.target) continue;
    if (!byTarget.has(row.target)) byTarget.set(row.target, { ok: 0, no: 0 });
    const t = byTarget.get(row.target);
    if (row.kind === 'written' || row.kind === 'skipped' || row.kind === 'drifted') t.ok++;
    else t.no++;
  }
  if (byTarget.size) {
    lines.push('| цель | собрано | нет |', '|---|---:|---:|');
    for (const [target, t] of [...byTarget].sort())
      lines.push(`| \`${target}\` | ${t.ok} | ${t.no || ''} |`);
    lines.push('');
  }

  for (const [key, name] of KINDS) {
    if (key === 'written' || key === 'skipped') continue;
    const list = all.filter(x => x.kind === key);
    if (!list.length) continue;
    lines.push(`### ${name}`, '');
    for (const x of list)
      lines.push(`- ${x.path ?? `\`${x.file}\` [\`${x.target}\`]${x.why ? ' — ' + x.why : ''}`}`);
    lines.push('');
  }

  if (root) lines.push(`_корень: ${root}_`, '');
  return lines.join('\n');
}

export const format = (r, path, extra) =>
  path.endsWith('.json') ? toJson(r, extra) : toMarkdown(r, extra);
