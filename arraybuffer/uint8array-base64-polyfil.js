/* Uint8Array ⇄ base64 / hex — ES2026
   Uint8Array.prototype.toBase64, Uint8Array.fromBase64,
   Uint8Array.prototype.toHex, Uint8Array.fromHex */
(function () {
  if (typeof Uint8Array !== 'function') return;
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var HEX = '0123456789abcdef';

  function check(self, name) {
    if (!(self instanceof Uint8Array)) throw new TypeError('Uint8Array.prototype.' + name + ' called on incompatible receiver');
  }
  function alphabetOf(options) {
    var a = options && options.alphabet !== undefined ? options.alphabet : 'base64';
    if (a !== 'base64' && a !== 'base64url') throw new TypeError('expected alphabet to be "base64" or "base64url"');
    return a === 'base64' ? B64 : URL;
  }

  __dg_define(Uint8Array.prototype, 'toBase64', function (options) {
    check(this, 'toBase64');
    var chars = alphabetOf(options), pad = !(options && options.omitPadding), s = '';
    for (var i = 0; i < this.length; i += 3) {
      var n = this[i] << 16 | (i + 1 < this.length ? this[i + 1] << 8 : 0) | (i + 2 < this.length ? this[i + 2] : 0);
      s += chars.charAt(n >> 18 & 63) + chars.charAt(n >> 12 & 63);
      s += i + 1 < this.length ? chars.charAt(n >> 6 & 63) : pad ? '=' : '';
      s += i + 2 < this.length ? chars.charAt(n & 63) : pad ? '=' : '';
    }
    return s;
  });

  __dg_define(Uint8Array, 'fromBase64', function (string, options) {
    if (typeof string !== 'string') throw new TypeError('expected input to be a string');
    var chars = alphabetOf(options);
    var last = options && options.lastChunkHandling !== undefined ? options.lastChunkHandling : 'loose';
    if (last !== 'loose' && last !== 'strict' && last !== 'stop-before-partial')
      throw new TypeError('expected lastChunkHandling to be "loose", "strict" or "stop-before-partial"');
    var s = string.replace(/[\t\n\f\r ]+/g, ''), padded = /=+$/.exec(s), body = padded ? s.slice(0, padded.index) : s;
    if (padded && (padded[0].length > 2 || (body.length + padded[0].length) % 4)) throw new SyntaxError('invalid base64 padding');
    var rest = body.length % 4;
    if (rest === 1) throw new SyntaxError('invalid base64 length');
    if (rest && !padded) {
      if (last === 'strict') throw new SyntaxError('missing base64 padding');
      if (last === 'stop-before-partial') body = body.slice(0, body.length - rest);
    }
    var out = [], acc = 0, bits = 0;
    for (var i = 0; i < body.length; i++) {
      var v = chars.indexOf(body.charAt(i));
      if (v < 0) throw new SyntaxError('invalid base64 character');
      acc = (acc << 6 | v) & 0xffffff;
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push(acc >> bits & 255); }
    }
    if (last === 'strict' && bits && (acc & (1 << bits) - 1)) throw new SyntaxError('non-zero base64 padding bits');
    return new Uint8Array(out);
  });

  __dg_define(Uint8Array.prototype, 'toHex', function () {
    check(this, 'toHex');
    var s = '';
    for (var i = 0; i < this.length; i++) s += HEX.charAt(this[i] >> 4) + HEX.charAt(this[i] & 15);
    return s;
  });

  __dg_define(Uint8Array, 'fromHex', function (string) {
    if (typeof string !== 'string') throw new TypeError('expected input to be a string');
    if (string.length % 2) throw new SyntaxError('hex string must have an even length');
    var out = new Uint8Array(string.length / 2);
    for (var i = 0; i < out.length; i++) {
      var h = string.substr(i * 2, 2);
      if (!/^[0-9a-fA-F]{2}$/.test(h)) throw new SyntaxError('invalid hex character');
      out[i] = parseInt(h, 16);
    }
    return out;
  });
})();
