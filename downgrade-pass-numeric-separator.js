/* numeric-separator — `1_000_000` (ES2021) → `1000000`

   Разделитель — чистая косметика литерала: значение то же. */

import { rewrite } from './downgrade-rewrite.js';

export default {
  id: 'numeric-separator',
  year: 2021,
  features: ['numericSeparator'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      Literal(n) {
        if (typeof n.raw === 'string' && /^[0-9.]/.test(n.raw) && n.raw.includes('_'))
          return { text: n.raw.replace(/_/g, ''), prec: 19 };
      },
    }, { session });
  },
};
