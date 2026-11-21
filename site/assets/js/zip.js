// ZIP без сжатия (store) — чтобы скачать чеки за день или месяц одним файлом, без библиотек.
// Чеки — JPG/PNG/PDF, они уже сжаты. Архив собирается из частей (заголовки + сами Blob чеков),
// поэтому чеки не копируются в память ещё раз — важно на телефоне для большого месяца.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Время и дата в формате MS-DOS, как их хранит ZIP */
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Файл для архива из байтов: CRC и размер считаются сразу */
export function zipEntry(name, bytes, date) {
  return { name, data: bytes, crc: crc32(bytes), size: bytes.length, date };
}

/**
 * Части ZIP-архива для new Blob(parts).
 * @param {{ name: string, data: Uint8Array | Blob, crc: number, size: number, date?: Date }[]} entries —
 *   имена могут быть по-русски и с папками через «/» (флаг UTF-8)
 */
export function zipParts(entries) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const { time, date } = dosDateTime(entry.date || new Date());

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);       // версия для распаковки
    local.setUint16(6, 0x0800, true);   // имена в UTF-8
    local.setUint16(8, 0, true);        // без сжатия
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, entry.crc, true);
    local.setUint32(18, entry.size, true);
    local.setUint32(22, entry.size, true);
    local.setUint16(26, name.length, true);
    locals.push(new Uint8Array(local.buffer), name, entry.data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, entry.crc, true);
    central.setUint32(20, entry.size, true);
    central.setUint32(24, entry.size, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true); // где начинается локальный заголовок
    centrals.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.length + entry.size;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return [...locals, ...centrals, new Uint8Array(end.buffer)];
}
