/* union, intersection, difference, symmetricDifference, isSubsetOf,
   isSupersetOf, isDisjointFrom — ES2025. Второй операнд — «похожий на
   множество»: size, has(), keys(), как в спецификации (GetSetRecord). */
(function () {
  if (typeof Set !== 'function') return;
  function self(s) {
    if (Object.prototype.toString.call(s) !== '[object Set]') throw new TypeError('Set method called on incompatible receiver');
    return s;
  }
  function record(o) {
    if (o === null || (typeof o !== 'object' && typeof o !== 'function')) throw new TypeError('The other argument is not an object');
    var size = +o.size;
    if (size !== size) throw new TypeError("The other argument's size is not a number");
    if (typeof o.has !== 'function') throw new TypeError("The other argument's has is not a function");
    if (typeof o.keys !== 'function') throw new TypeError("The other argument's keys is not a function");
    return { o: o, size: __dg_toInt(size) };
  }
  /* перебрать keys() второго операнда; fn вернула false — остановиться */
  function eachKey(r, fn) {
    var it = r.o.keys(), step;
    while (!(step = it.next()).done) if (fn(step.value) === false) return false;
    return true;
  }
  function each(s, fn) {
    var items = [];
    s.forEach(function (v) { items.push(v); });
    for (var i = 0; i < items.length; i++) if (fn(items[i]) === false) return false;
    return true;
  }
  var P = Set.prototype;
  __dg_define(P, 'union', function (other) {
    var r = record(other), out = new Set(self(this));
    eachKey(r, function (v) { out.add(v); });
    return out;
  });
  __dg_define(P, 'intersection', function (other) {
    var s = self(this), r = record(other), out = new Set();
    if (s.size <= r.size) each(s, function (v) { if (r.o.has(v)) out.add(v); });
    else eachKey(r, function (v) { if (s.has(v)) out.add(v); });
    return out;
  });
  __dg_define(P, 'difference', function (other) {
    var s = self(this), r = record(other), out = new Set(s);
    if (s.size <= r.size) each(s, function (v) { if (r.o.has(v)) out['delete'](v); });
    else eachKey(r, function (v) { out['delete'](v); });
    return out;
  });
  __dg_define(P, 'symmetricDifference', function (other) {
    var s = self(this), r = record(other), out = new Set(s);
    eachKey(r, function (v) { if (s.has(v)) out['delete'](v); else out.add(v); });
    return out;
  });
  __dg_define(P, 'isSubsetOf', function (other) {
    var s = self(this), r = record(other);
    if (s.size > r.size) return false;
    return each(s, function (v) { if (!r.o.has(v)) return false; });
  });
  __dg_define(P, 'isSupersetOf', function (other) {
    var s = self(this), r = record(other);
    if (s.size < r.size) return false;
    return eachKey(r, function (v) { if (!s.has(v)) return false; });
  });
  __dg_define(P, 'isDisjointFrom', function (other) {
    var s = self(this), r = record(other);
    if (s.size <= r.size) return each(s, function (v) { if (r.o.has(v)) return false; });
    return eachKey(r, function (v) { if (s.has(v)) return false; });
  });
})();
