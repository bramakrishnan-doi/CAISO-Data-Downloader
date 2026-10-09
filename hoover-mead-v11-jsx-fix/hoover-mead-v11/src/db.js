const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS days (
  date_key TEXT PRIMARY KEY,
  date_display TEXT NOT NULL,
  he01 REAL, he02 REAL, he03 REAL, he04 REAL, he05 REAL,
  he06 REAL, he07 REAL, he08 REAL, he09 REAL, he10 REAL,
  he11 REAL, he12 REAL, he13 REAL, he14 REAL, he15 REAL,
  he16 REAL, he17 REAL, he18 REAL, he19 REAL, he20 REAL,
  he21 REAL, he22 REAL, he23 REAL, he24 REAL, he25 REAL,
  imported_at TEXT NOT NULL,
  source TEXT DEFAULT 'csv'
);
CREATE INDEX IF NOT EXISTS idx_date_key ON days(date_key);
`;

const HE_COLS = Array.from({length: 25}, (_, i) => 'he' + String(i+1).padStart(2,'0'));

class DB {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.SQL = null;
    this.db = null;
    this.ready = this._init();
  }

  async _init() {
    // sql.js's package.json restricts subpath exports, so require.resolve('sql.js/package.json')
    // throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve via the main entry file instead, which IS exported.
    const sqlJsMainPath = require.resolve('sql.js');
    const wasmPath = path.join(path.dirname(sqlJsMainPath), 'sql-wasm.wasm');

    this.SQL = await initSqlJs({
      locateFile: () => wasmPath
    });

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(fileBuffer);
    } else {
      this.db = new this.SQL.Database();
    }
    this.db.run(SCHEMA);
    this._persist();
  }

  // Every write must call this to flush the in-memory DB back to disk.
  _persist() {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  async whenReady() {
    await this.ready;
  }

  close() {
    if (this.db) {
      this._persist();
      this.db.close();
    }
  }

  dayExists(dateKey) {
    const stmt = this.db.prepare('SELECT 1 FROM days WHERE date_key = ?');
    stmt.bind([dateKey]);
    const exists = stmt.step();
    stmt.free();
    return exists;
  }

  getAllDays() {
    const stmt = this.db.prepare('SELECT * FROM days ORDER BY date_key ASC');
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows.map(r => {
      const hours = {};
      HE_COLS.forEach((c, i) => { hours['HE' + String(i+1).padStart(2,'0')] = r[c]; });
      return {
        key: r.date_key,
        date: r.date_display,
        hours,
        importedAt: r.imported_at,
        source: r.source
      };
    });
  }

  // record: { key, date, hours: {HE01..HE25}, source }
  upsertDay(record, overwrite = false) {
    if (!overwrite && this.dayExists(record.key)) {
      return { skipped: true };
    }
    // Preserve known prices when a partial download is returned. Never delete first.
    if (overwrite && this.dayExists(record.key)) {
      const stmt = this.db.prepare('SELECT * FROM days WHERE date_key = ?');
      stmt.bind([record.key]);
      const old = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      if (old) {
        const merged = {...record.hours};
        HE_COLS.forEach((c,i) => {
          const h = 'HE' + String(i+1).padStart(2,'0');
          if (typeof merged[h] !== 'number' || !Number.isFinite(merged[h])) merged[h] = old[c];
        });
        record = {...record, hours:merged};
      }
    }
    const cols = ['date_key', 'date_display', ...HE_COLS, 'imported_at', 'source'];
    const placeholders = cols.map(() => '?').join(',');
    const values = [
      record.key,
      record.date,
      ...HE_COLS.map((c, i) => {
        const heKey = 'HE' + String(i+1).padStart(2,'0');
        const v = record.hours[heKey];
        return (v === null || v === undefined || isNaN(v)) ? null : v;
      }),
      new Date().toISOString(),
      record.source || 'csv'
    ];
    const sql = `INSERT OR REPLACE INTO days (${cols.join(',')}) VALUES (${placeholders})`;
    this.db.run(sql, values);
    this._persist();
    return { saved: true };
  }
}

module.exports = DB;