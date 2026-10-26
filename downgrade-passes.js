/* ══════════════════════════════════════════════════════════════════════════
   passes/ — проходы понижения синтаксиса, по одному на возможность

   Порядок — от новых возможностей к старым: понижение нового порождает
   старое (`??=` → `??`, поле класса → defineProperty, async → генератор),
   и следующий проход подбирает то, что оставил предыдущий. Наоборот
   не бывает: ни один проход не порождает возможность новее своей.
   ══════════════════════════════════════════════════════════════════════════ */

import classMembers from './downgrade-pass-class-members.js';
import logicalAssignment from './downgrade-pass-logical-assignment.js';
import numericSeparator from './downgrade-pass-numeric-separator.js';
import optionalChaining from './downgrade-pass-optional-chaining.js';
import nullish from './downgrade-pass-nullish.js';
import optionalCatch from './downgrade-pass-optional-catch.js';
import jsonSuperset from './downgrade-pass-json-superset.js';
import objectRestSpread from './downgrade-pass-object-rest-spread.js';
import regexpDotAll from './downgrade-pass-regexp-dotall.js';
import asyncFunctions from './downgrade-pass-async-functions.js';
import trailingComma from './downgrade-pass-trailing-comma.js';
import exponent from './downgrade-pass-exponent.js';
import classes from './downgrade-pass-classes.js';
import templateLiterals from './downgrade-pass-template-literals.js';
import arrow from './downgrade-pass-arrow.js';
import parameters from './downgrade-pass-parameters.js';
import spread from './downgrade-pass-spread.js';
import forOf from './downgrade-pass-for-of.js';
import destructuring from './downgrade-pass-destructuring.js';
import objectLiteral from './downgrade-pass-object-literal.js';
import es5Literals from './downgrade-pass-es5-literals.js';
import blockScoping from './downgrade-pass-block-scoping.js';
import es3Props from './downgrade-pass-es3-props.js';
import generators from './downgrade-pass-generators.js';
import regexpUnicode from './downgrade-pass-regexp-unicode.js';

export const PASSES = [
  classMembers,                 // 2022
  logicalAssignment,            // 2021 → ??
  numericSeparator,             // 2021
  optionalChaining,             // 2020
  nullish,                      // 2020
  optionalCatch,                // 2019
  jsonSuperset,                 // 2019
  objectRestSpread,             // 2018
  regexpDotAll,                 // 2018
  asyncFunctions,               // 2017 → генераторы
  trailingComma,                // 2017
  exponent,                     // 2016

  /* ES2015 → ES5. Порядок внутри года важен:
       классы раньше spread — `super(…args)` становится `.call(this, …args)`,
                              и spread разбирает уже обычный вызов;
       стрелки раньше параметров — умолчания читаются из arguments,
                              а у стрелки своего arguments нет;
       for-of раньше деструктуризации — он выносит образец витка в тело;
       блочная область раньше генераторов — машина состояний собирается по телу,
                              где объявления уже var, циклы обычные, а for-of
                              разложен в цикл по итератору. */
  regexpUnicode,                // 2015 (и свойства Unicode из 2018: их разворачивает
                                //       тот же разбор шаблона, отдельный проход
                                //       был бы его копией)
  classes,
  templateLiterals,
  arrow,
  parameters,
  spread,
  forOf,
  destructuring,
  objectLiteral,
  es5Literals,
  blockScoping,
  generators,                   // машина состояний строится по уже понижённому телу

  es3Props,                     // 2009
];

/* порядок — часть контракта: проверяется, а не только описан */
for (let i = 1; i < PASSES.length; i++)
  if (PASSES[i].year > PASSES[i - 1].year)
    throw new Error(`passes: ${PASSES[i].id} (${PASSES[i].year}) стоит после ${PASSES[i - 1].id} (${PASSES[i - 1].year})`);
