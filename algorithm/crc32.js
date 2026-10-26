/* ══════════════════════════════════════════════════════════════════════════
   crc32.js — CRC-32/ISO-HDLC, он же «zip CRC»

   Полином 0xEDB88320 (отражённый 0x04C11DB7), init и xorout 0xFFFFFFFF,
   отражённые ввод и вывод. Табличный вариант, 256 записей, таблица строится
   один раз при загрузке модуля.

     crc32(buf, from, to) → uint32

   Не про изображения: та же сумма стоит в чанках PNG, в zip и gzip,
   в Ethernet FCS, в SATA и в Modbus-over-TCP.
   ══════════════════════════════════════════════════════════════════════════ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, from, to) {
  let c = 0xFFFFFFFF;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export { crc32, CRC_TABLE };
