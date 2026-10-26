/* trailing-comma — запятая после последнего аргумента или параметра (ES2017)

     f(a, b,)            →  f(a, b)
     function f(a, b,)   →  function f(a, b)

   В литералах массивов и объектов такая запятая законна с ES5 и здесь не
   трогается. Удаляется ровно один символ — всё вокруг, включая перевод
   строки и комментарии, остаётся как было. */

import { rewrite, skipTrivia } from './downgrade-rewrite.js';

function dropComma(list, n, ctx) {
  if (!list.length) return;
  const p = skipTrivia(ctx.src, list.at(-1).end);
  if (ctx.src[p] !== ',') return;
  return ctx.splice(n, [{ start: p, end: p + 1, text: '' }]);
}

const params = (n, ctx) => dropComma(n.params, n, ctx);
const args = (n, ctx) => dropComma(n.arguments, n, ctx);

export default {
  id: 'trailing-comma',
  year: 2017,
  features: ['trailingComma'],
  run(code, ast, { session }) {
    return rewrite(code, ast, {
      FunctionDeclaration: params, FunctionExpression: params, ArrowFunctionExpression: params,
      CallExpression: args, NewExpression: args,
    }, { session });
  },
};
