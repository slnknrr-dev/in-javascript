/* optional-catch — `catch {` без параметра (ES2019) → `catch (__dg_e) {`

   Имя свежее на весь файл, так что тело обработчика не может на него
   случайно сослаться. */

import { rewrite } from './downgrade-rewrite.js';

export default {
  id: 'optional-catch',
  year: 2019,
  features: ['optionalCatch'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      CatchClause(n, ctx) {
        if (n.param) return;
        const kw = n.start + 'catch'.length;
        return ctx.splice(n, [{ start: kw, end: kw, text: ` (${ctx.scope.fresh('e')})` }]);
      },
    }, { session });
  },
};
