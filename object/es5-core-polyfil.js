/* ES5-минимум для целей ES3: Object.keys, Object.create,
   Object.getPrototypeOf, Array.isArray, Date.now, Function.prototype.bind,
   String.prototype.trim.

   Object.defineProperty здесь не полифилится: дескрипторов в ES3 нет,
   неперечислимое свойство и аксессор не выражаются вовсе — в таблице они
   помечены unsupported. Object.create поэтому понимает только дескрипторы
   со значением и не умеет прототип null. */
(function () {
  var hasOwn = Object.prototype.hasOwnProperty;

  /* В движках до ES5 свойство, перекрывающее встроенное (toString и
     соседи), не попадает в for-in — такие имена приходится перебирать
     поимённо. */
  var DONT_ENUM = ['toString', 'toLocaleString', 'valueOf', 'hasOwnProperty',
    'isPrototypeOf', 'propertyIsEnumerable', 'constructor'];
  var hidesOverrides = (function () {
    for (var k in { toString: 1 }) if (k === 'toString') return false;
    return true;
  })();

  __dg_define(Object, 'keys', function (obj) {
    if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function'))
      throw new TypeError('Object.keys called on non-object');
    var out = [];
    for (var k in obj) if (hasOwn.call(obj, k)) out.push(k);
    if (hidesOverrides)
      for (var i = 0; i < DONT_ENUM.length; i++)
        if (hasOwn.call(obj, DONT_ENUM[i])) out.push(DONT_ENUM[i]);
    return out;
  });

  __dg_define(Object, 'create', function (proto, props) {
    if (proto === null) throw new TypeError('Object.create(null) в ES3 недоступен');
    function Empty() {}
    Empty.prototype = proto;
    var obj = new Empty();
    if (props) {
      var keys = Object.keys(props);
      for (var i = 0; i < keys.length; i++) {
        var desc = props[keys[i]];
        if (desc.get || desc.set) throw new TypeError('аксессоры в ES3 недоступны');
        obj[keys[i]] = desc.value;
      }
    }
    return obj;
  });

  __dg_define(Object, 'getPrototypeOf', function (obj) {
    if (obj.__proto__ !== undefined) return obj.__proto__;
    if (obj.constructor && obj.constructor.prototype !== obj) return obj.constructor.prototype;
    return null;
  });

  __dg_define(Array, 'isArray', function (value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  });

  __dg_define(Date, 'now', function () { return new Date().getTime(); });

  __dg_define(Function.prototype, 'bind', function (thisArg) {
    var fn = this, bound = Array.prototype.slice.call(arguments, 1);
    if (typeof fn !== 'function') throw new TypeError('Bind must be called on a function');
    return function () {
      return fn.apply(thisArg, bound.concat(Array.prototype.slice.call(arguments)));
    };
  });

  __dg_define(String.prototype, 'trim', function () {
    return String(this).replace(/^\s+/, '').replace(/\s+$/, '');
  });
})();
