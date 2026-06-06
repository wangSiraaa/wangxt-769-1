const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "fresh_discount.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    role          TEXT    NOT NULL CHECK(role IN ('store_manager','admin')),
    display_name  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS product_batches (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name      TEXT    NOT NULL,
    sku               TEXT    NOT NULL,
    cost_price        REAL    NOT NULL CHECK(cost_price > 0),
    retail_price      REAL    NOT NULL CHECK(retail_price > 0),
    production_date   TEXT    NOT NULL,
    shelf_life_days   INTEGER NOT NULL CHECK(shelf_life_days > 0),
    expiry_date       TEXT    NOT NULL,
    shelf_life_note   TEXT,
    min_profit_rate   REAL    NOT NULL DEFAULT 0.05,
    status            TEXT    NOT NULL DEFAULT 'active',
    created_by        INTEGER NOT NULL,
    created_at        TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS discount_rules (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id          INTEGER NOT NULL,
    discount_rate     REAL    NOT NULL,
    discounted_price  REAL    NOT NULL,
    gross_profit_rate REAL    NOT NULL,
    status            TEXT    NOT NULL DEFAULT 'draft',
    reject_reason     TEXT,
    audit_conclusion  TEXT,
    audit_comment     TEXT,
    audited_by        INTEGER,
    audited_at        TEXT,
    withdraw_reason   TEXT,
    withdrawn_by      INTEGER,
    withdrawn_at      TEXT,
    operator          TEXT,
    published_at      TEXT,
    created_at        TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (batch_id) REFERENCES product_batches(id),
    FOREIGN KEY (audited_by) REFERENCES users(id),
    FOREIGN KEY (withdrawn_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS price_tags (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    discount_id     INTEGER NOT NULL,
    operator        TEXT    NOT NULL,
    tag_code        TEXT    NOT NULL,
    created_at      TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (discount_id) REFERENCES discount_rules(id)
  );
`;

function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function run(sql, params) {
  const stmt = db.prepare(sql);
  if (params && params.length > 0) stmt.bind(params);
  stmt.step();
  const lastId = db.exec("SELECT last_insert_rowid() AS id");
  const insertId = lastId.length > 0 ? lastId[0].values[0][0] : null;
  stmt.free();
  save();
  return { lastInsertRowid: insertId };
}

function get(sql, params) {
  const stmt = db.prepare(sql);
  if (params && params.length > 0) stmt.bind(params);
  if (!stmt.step()) { stmt.free(); return null; }
  const columns = stmt.getColumnNames();
  const values = stmt.get();
  stmt.free();
  const obj = {};
  columns.forEach((c, i) => { obj[c] = values[i]; });
  return obj;
}

function all(sql, params) {
  const stmt = db.prepare(sql);
  if (params && params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    const columns = stmt.getColumnNames();
    const values = stmt.get();
    const obj = {};
    columns.forEach((c, i) => { obj[c] = values[i]; });
    results.push(obj);
  }
  stmt.free();
  return results;
}

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(SCHEMA);

  const userRows = all("SELECT COUNT(*) AS c FROM users");
  if (userRows[0].c === 0) {
    run("INSERT INTO users (username, role, display_name) VALUES (?, ?, ?)", ["manager1", "store_manager", "张店长"]);
    run("INSERT INTO users (username, role, display_name) VALUES (?, ?, ?)", ["admin1", "admin", "系统管理员"]);
  }

  save();
  console.log("Database initialized");
}

module.exports = { initDb, run, get, all, save };
