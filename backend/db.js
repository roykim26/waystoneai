'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/waystone.db';
const abs = path.resolve(__dirname, DB_PATH);
fs.mkdirSync(path.dirname(abs), { recursive: true });

const db = new Database(abs);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS submissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name       TEXT    NOT NULL,
  product_url     TEXT    NOT NULL,
  one_liner       TEXT    NOT NULL DEFAULT '',
  category        TEXT    NOT NULL DEFAULT '',
  email           TEXT    NOT NULL,
  tier            TEXT    NOT NULL CHECK (tier IN ('free','founding')),
  backlink_agreed INTEGER NOT NULL DEFAULT 0,
  consent         INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','contacted','approved','rejected')),
  notes           TEXT    NOT NULL DEFAULT '',
  review_due_at   TEXT,
  backlink_status TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (backlink_status IN ('pending','detected','grace','missing','not_required')),
  backlink_href   TEXT,
  backlink_rel    TEXT,
  last_checked_at TEXT,
  missing_since   TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_tier   ON submissions(tier);
`);

const now = () => new Date().toISOString();

// 审核时限：免费档 7 天，创始档 48 小时（对齐 01/02 方案）
function reviewDue(tier) {
  const hours = tier === 'founding' ? 48 : 24 * 7;
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

const insertStmt = db.prepare(`
  INSERT INTO submissions
    (tool_name, product_url, one_liner, category, email, tier,
     backlink_agreed, consent, status, notes, review_due_at,
     backlink_status, created_at, updated_at)
  VALUES
    (@tool_name, @product_url, @one_liner, @category, @email, @tier,
     @backlink_agreed, @consent, 'new', '', @review_due_at,
     @backlink_status, @created_at, @updated_at)
`);

function createSubmission(data) {
  const ts = now();
  const row = {
    tool_name: data.tool_name,
    product_url: data.product_url,
    one_liner: data.one_liner || '',
    category: data.category || '',
    email: data.email,
    tier: data.tier,
    backlink_agreed: data.backlink_agreed ? 1 : 0,
    consent: data.consent ? 1 : 0,
    review_due_at: reviewDue(data.tier),
    backlink_status: data.tier === 'founding' ? 'not_required' : 'pending',
    created_at: ts,
    updated_at: ts
  };
  const info = insertStmt.run(row);
  return getSubmission(info.lastInsertRowid);
}

const getStmt = db.prepare('SELECT * FROM submissions WHERE id = ?');
function getSubmission(id) {
  return getStmt.get(id);
}

function listSubmissions({ status, tier } = {}) {
  let sql = 'SELECT * FROM submissions';
  const where = [];
  const params = {};
  if (status) { where.push('status = @status'); params.status = status; }
  if (tier) { where.push('tier = @tier'); params.tier = tier; }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC, id DESC';
  return db.prepare(sql).all(params);
}

const updateStmt = db.prepare(`
  UPDATE submissions
     SET status = @status, notes = @notes, updated_at = @updated_at
   WHERE id = @id
`);
function updateSubmission(id, { status, notes }) {
  const cur = getSubmission(id);
  if (!cur) return null;
  updateStmt.run({
    id,
    status: status !== undefined ? status : cur.status,
    notes: notes !== undefined ? notes : cur.notes,
    updated_at: now()
  });
  return getSubmission(id);
}

const backlinkStmt = db.prepare(`
  UPDATE submissions
     SET backlink_status = @backlink_status,
         backlink_href   = @backlink_href,
         backlink_rel    = @backlink_rel,
         last_checked_at = @last_checked_at,
         missing_since   = @missing_since,
         updated_at      = @updated_at
   WHERE id = @id
`);
function updateBacklink(id, fields) {
  backlinkStmt.run({
    id,
    backlink_status: fields.backlink_status,
    backlink_href: fields.backlink_href ?? null,
    backlink_rel: fields.backlink_rel ?? null,
    last_checked_at: fields.last_checked_at ?? now(),
    missing_since: fields.missing_since ?? null,
    updated_at: now()
  });
  return getSubmission(id);
}

// 待校验：免费档且已审核通过（approved）的提交
const pendingChecksStmt = db.prepare(`
  SELECT * FROM submissions
   WHERE tier = 'free' AND status = 'approved'
   ORDER BY last_checked_at ASC
`);
function pendingBacklinkChecks() {
  return pendingChecksStmt.all();
}

module.exports = {
  db,
  now,
  createSubmission,
  getSubmission,
  listSubmissions,
  updateSubmission,
  updateBacklink,
  pendingBacklinkChecks
};
