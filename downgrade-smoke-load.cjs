/* ══════════════════════════════════════════════════════════════════════════
   downgrade-smoke-load.cjs — «грузится ли артефакт» на том node, под которым запущен

   Написан на ES5 и на CommonJS намеренно: его запускают и под node 24, и
   под node 4, и под node 5 — то есть под теми же движками, ради которых
   артефакты и понижаются. Ничего, кроме require, тут быть не должно.

     node downgrade-smoke-load.cjs файл…

   На каждый файл печатается `ok` или `FAIL` с сообщением; код возврата 1,
   если хоть один упал. ESM-артефакт грузится динамическим import'ом — на
   движке, который его не знает, файл помечается `skip`: его цель для этого
   движка и не предназначалась.
   ══════════════════════════════════════════════════════════════════════════ */

var fs = require('fs');
var path = require('path');

var argv = process.argv.slice(2);
var quiet = argv.indexOf('-q') >= 0;
var files = argv.filter(function (a) { return a !== '-q'; });
var ok = 0, failed = 0, skipped = 0;

function isModule(file) {
  try {
    var pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'package.json'), 'utf8'));
    return pkg.type === 'module';
  } catch (e) { return false; }
}

/* import() — синтаксис, которого в старых движках нет; строим через
   Function, чтобы файл разобрался и там, где его не поддержат */
var dynamicImport = null;
try { dynamicImport = new Function('u', 'return import(u);'); } catch (e) { dynamicImport = null; }

function done(file, e) {
  if (!e) { ok++; if (!quiet) console.log('ok   ' + file); return; }
  failed++;
  console.log('FAIL ' + file + ' — ' + (e && e.message ? e.message : e));
}

function loadNext(i) {
  if (i >= files.length) {
    console.log(quiet ? '# ' + ok + ' ' + skipped + ' ' + failed
      : 'загружено: ' + ok + ', пропущено: ' + skipped + ', упало: ' + failed);
    process.exit(failed ? 1 : 0);
    return;
  }
  var file = files[i];
  if (isModule(file)) {
    if (!dynamicImport) {
      skipped++;
      if (!quiet) console.log('skip ' + file + ' — движок не умеет ESM');
      loadNext(i + 1);
      return;
    }
    var url = 'file://' + path.resolve(file).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:');
    dynamicImport(url).then(function () { done(file, null); loadNext(i + 1); },
      function (e) { done(file, e); loadNext(i + 1); });
    return;
  }
  try { require(path.resolve(file)); done(file, null); }
  catch (e) { done(file, e); }
  loadNext(i + 1);
}

if (!files.length) { console.log('нечего грузить'); process.exit(0); }
loadNext(0);
