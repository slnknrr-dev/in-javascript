/* ══════════════════════════════════════════════════════════════════════════
   profiles.js — профиль цели: что она умеет сама

   es-цели описываются одним числом — редакцией стандарта: es6 = ES2015,
   es16 = ES2025. Всё, что появилось позже, понижается.

   nodejs-цели в одно число не укладываются: node 13 умеет поля классов
   и BigInt (ES2022 и ES2020), но не умеет `?.` (ES2020). Поэтому у
   профиля есть базовая редакция и список возможностей сверх неё — по
   node.green, BACKLOG.md §4.3. Для runtime-примитивов у nodejs-цели есть
   ещё и номер версии node: у них своя таблица (downgrade-runtime-features.json).
   ══════════════════════════════════════════════════════════════════════════ */

import { FEATURES, edition } from './downgrade-features.js';

const NODE_PROFILES = {
  /* ES5 strict; ES2015-примитивы есть, синтаксис — нет (BACKLOG §4.3) */
  5: { es: 5, extra: [] },
  /* ES2019 + поля классов (12), BigInt (10.4), разделители в числах (12.5);
     без `?.`/`??` (14), логических присваиваний (15), приватных методов (14.6) */
  13: { es: 10, extra: ['classFields', 'privateFields', 'bigint', 'numericSeparator', 'dynamicImport', 'importMeta'] },
  /* ES2022 целиком */
  18: { es: 13, extra: [] },
  /* ES2024 + атрибуты импорта */
  21: { es: 15, extra: ['importAttributes'] },
};

const TARGET = /^(es|nodejs)(\d+)@(cjs|mjs|ts)$/;

export function profileOf(target) {
  const m = TARGET.exec(target);
  if (!m) throw new Error(`неизвестная цель ${target}`);
  const [, matrix, num, mod] = m;
  const modules = mod === 'mjs' ? 'esm' : mod;
  if (matrix === 'es')
    return { target, matrix, modules, es: Number(num), extra: new Set(), node: null };
  const p = NODE_PROFILES[num];
  if (!p) throw new Error(`для ${target} нет профиля node`);
  return { target, matrix, modules, es: p.es, extra: new Set(p.extra), node: Number(num) };
}

/* цель умеет эту возможность сама? */
export function supports(profile, id) {
  const f = FEATURES[id];
  if (!f) throw new Error(`неизвестная возможность ${id}`);
  /* import.meta и top-level await — только у ES-модуля */
  if ((id === 'importMeta' || id === 'topLevelAwait') && profile.modules !== 'esm' && profile.modules !== 'ts') return false;
  if (id === 'modules') return profile.modules !== 'cjs';
  return edition(f.year) <= profile.es || profile.extra.has(id);
}

/* название уровня для отчётов: ES2015, ES5 */
export const esName = es => (es >= 6 ? `ES${es + 2009}` : `ES${es}`);
