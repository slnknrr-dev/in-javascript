/* ══════════════════════════════════════════════════════════════════════════
   passes/refs.js — «вычислить один раз» для проходов понижения

   Почти каждое понижение читает выражение дважды: `a ?? b` становится
   `a !== null && a !== void 0 ? a : b`. Если `a` — имя, это безопасно;
   если вызов или обращение к свойству — нет: побочный эффект случится
   дважды, а геттер может вернуть другое. Тогда первое чтение кладёт
   значение во временную переменную, остальные читают её.
   ══════════════════════════════════════════════════════════════════════════ */

import { isSimple, PREC } from './downgrade-rewrite.js';

/* { first, again }: first — текст для первого вычисления (возможно, с
   присваиванием во временную), again — для всех следующих */
export function once(node, ctx, base = 'ref') {
  if (isSimple(node) && node.type !== 'Super') {
    const t = ctx.expr(node, PREC.CALL);
    return { first: t, again: t, simple: true };
  }
  const t = ctx.temp(node, base);
  return { first: `(${t} = ${ctx.expr(node, PREC.ASSIGN)})`, again: t, simple: false };
}

/* Цель составного присваивания (`x op= v`) как пара «прочитать» и
   «записать», где объект и вычисляемый ключ вычисляются один раз:

     a        read: a            write: a = V
     o.p      read: t.p          write: (t = o).p = V      (t — если o не имя)
     o[k]     read: t[u]         write: (t = o)[u = k] = V

   Порядок вычисления — как у языка: объект, ключ, чтение, значение,
   запись. `write` возвращает текст присваивания (prec ASSIGN), и чтение
   обязано стоять справа от него — внутри V. */
export function assignTarget(node, ctx) {
  if (node.type === 'Identifier') {
    const name = node.name;
    return { read: name, write: v => `${name} = ${v}` };
  }
  if (node.type !== 'MemberExpression')
    ctx.fail('pending', node, `составное присваивание в ${node.type} не понижается`);

  /* Имя в роли объекта или ключа можно прочитать дважды: оба чтения
     случаются до вычисления V, так что даже `o[k] **= (k = 1)` читает
     старое k — ссылка слева разрешается раньше правой части. */
  const objSimple = isSimple(node.object);
  const obj = objSimple ? null : ctx.temp(node, 'obj');

  let keyFirst, keyAgain;
  if (!node.computed) {
    const prop = node.property.type === 'PrivateIdentifier' ? '#' + node.property.name : node.property.name;
    keyFirst = keyAgain = '.' + prop;
  } else if (isSimple(node.property)) {
    keyFirst = keyAgain = `[${ctx.text(node.property)}]`;
  } else {
    const k = ctx.temp(node, 'key');
    keyFirst = `[${k} = ${ctx.expr(node.property, PREC.ASSIGN)}]`;
    keyAgain = `[${k}]`;
  }

  const objFirst = objSimple ? ctx.expr(node.object, PREC.CALL) : `(${obj} = ${ctx.expr(node.object, PREC.ASSIGN)})`;
  const objAgain = objSimple ? ctx.expr(node.object, PREC.CALL) : obj;
  return {
    read: objAgain + keyAgain,
    write: v => `${objFirst}${keyFirst} = ${v}`,
  };
}
