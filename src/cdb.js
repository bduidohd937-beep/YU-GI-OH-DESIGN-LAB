const SQLITE_MAGIC = 'SQLite format 3\u0000';

export function readCardDatabase(SQL, bytes, origin = '카드.cdb') {
  if (!(bytes instanceof Uint8Array)) throw new Error('CDB 데이터는 Uint8Array여야 합니다.');
  if (bytes.length < 100) throw new Error('SQLite 데이터베이스가 너무 작습니다.');
  const signature = String.fromCharCode(...bytes.subarray(0, 16));
  if (signature !== SQLITE_MAGIC) throw new Error('SQLite CDB 헤더가 올바르지 않습니다.');
  const db = new SQL.Database(bytes);
  try {
    const tables = new Set(db.exec("SELECT name FROM sqlite_master WHERE type='table'")
      .flatMap((r) => r.values.map((v) => v[0])));
    if (!tables.has('datas') || !tables.has('texts')) {
      throw new Error('EDOPro 표준 datas/texts 테이블이 없습니다.');
    }
    const dataColumns = new Set(db.exec('PRAGMA table_info(datas)')[0]?.values.map((v) => v[1]) || []);
    const textColumns = new Set(db.exec('PRAGMA table_info(texts)')[0]?.values.map((v) => v[1]) || []);
    if (!['id', 'type'].every((k) => dataColumns.has(k))
      || !['id', 'name', 'desc'].every((k) => textColumns.has(k))) {
      throw new Error('필수 카드 ID·타입·이름·설명 필드가 없습니다.');
    }
    const columns = Array.from({ length: 16 }, (_, i) => 'str' + (i + 1));
    const fields = columns.map((s) => textColumns.has(s) ? 't.' + s : "''").join(', ');
    const rows = db.exec('SELECT d.id, d.type, t.name, t.desc, ' + fields +
      ' FROM datas AS d INNER JOIN texts AS t ON d.id=t.id ORDER BY d.id');
    const cards = (rows[0]?.values || []).map((row) => ({
      id: String(row[0]), type: Number(row[1]) >>> 0,
      name: String(row[2] || ''), desc: String(row[3] || ''),
      strings: row.slice(4).map((v) => String(v || '')), origin
    }));
    const warnings = [];
    const missing = db.exec('SELECT COUNT(*) FROM datas d LEFT JOIN texts t ON d.id=t.id WHERE t.id IS NULL');
    if (missing[0]?.values?.[0]?.[0] > 0) {
      warnings.push(origin + ': datas에는 있지만 texts에 없는 카드 ' + missing[0].values[0][0] + '종');
    }
    const invalid = db.exec('SELECT COUNT(*) FROM texts t LEFT JOIN datas d ON t.id=d.id WHERE d.id IS NULL');
    if (invalid[0]?.values?.[0]?.[0] > 0) {
      warnings.push(origin + ': texts에는 있지만 datas에 없는 카드 ' + invalid[0].values[0][0] + '종');
    }
    return { cards, warnings };
  } finally {
    db.close();
  }
}
