'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const express = require('express');
const cron = require('node-cron');

const store = require('./db');
const backlink = require('./backlink');
const notify = require('./notify');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const STATIC_DIR = path.resolve(__dirname, process.env.STATIC_DIR || '../预售落地页');
const CHECK_CRON = process.env.CHECK_CRON || '0 */6 * * *';

const app = express();
app.set('trust proxy', 1); // 位于 Nginx 反代之后，取真实客户端 IP
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// ---------- 公共：表单提交 ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIERS = ['free', 'founding'];
const STATUSES = ['new', 'contacted', 'approved', 'rejected'];

// 轻量限流：单 IP 10 分钟内最多 5 次提交
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 5;
}

function validateSubmission(b) {
  const tool_name = String(b.tool_name || '').trim();
  const product_url = String(b.product_url || '').trim();
  const one_liner = String(b.one_liner || '').trim();
  const category = String(b.category || '').trim();
  const email = String(b.email || '').trim();
  const tier = String(b.tier || '').trim();

  if (!tool_name || tool_name.length > 120) return 'Tool name is required (≤120 chars).';
  let u;
  try { u = new URL(product_url); } catch { return 'A valid product URL is required.'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Product URL must start with http:// or https://.';
  if (!one_liner || one_liner.length > 120) return 'One-line description is required (≤120 chars).';
  if (!category || category.length > 60) return 'Please select a category.';
  if (!EMAIL_RE.test(email) || email.length > 200) return 'A valid email is required.';
  if (!TIERS.includes(tier)) return 'Invalid tier.';
  if (!b.consent) return 'You must agree to the Privacy and Refund policies.';
  if (tier === 'free' && !b.backlink_agreed) return 'The free tier requires agreeing to add the backlink badge.';
  return null;
}

app.post('/api/submissions', (req, res) => {
  const b = req.body || {};
  // 蜜罐：隐藏字段 website 被填写则判定为机器人，静默丢弃
  if (b.website) return res.json({ ok: true });
  if (rateLimited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many submissions. Please try again later.' });

  const err = validateSubmission(b);
  if (err) return res.status(400).json({ ok: false, error: err });

  const row = store.createSubmission({
    tool_name: String(b.tool_name).trim(),
    product_url: String(b.product_url).trim(),
    one_liner: String(b.one_liner || '').trim(),
    category: String(b.category || '').trim(),
    email: String(b.email).trim(),
    tier: String(b.tier).trim(),
    backlink_agreed: !!b.backlink_agreed,
    consent: !!b.consent
  });
  res.json({ ok: true, id: row.id });

  // 异步通知：站长群机器人 + 提交人确认邮件，失败只记日志
  notify.notifyAdmin(row).catch((e) => console.error('[notify] admin webhook failed:', e.message));
  notify.sendConfirmation(row).catch((e) => console.error('[notify] confirmation email failed:', e.message));
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- 后台：token 鉴权 ----------
function adminAuth(req, res, next) {
  if (!ADMIN_TOKEN || ADMIN_TOKEN === 'change-me-to-a-long-random-string') {
    return res.status(503).json({ ok: false, error: 'ADMIN_TOKEN is not configured on the server.' });
  }
  const token = req.get('x-admin-token') || '';
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Invalid admin token.' });
  next();
}

app.get('/api/admin/submissions', adminAuth, (req, res) => {
  const { status, tier } = req.query;
  const rows = store.listSubmissions({
    status: STATUSES.includes(status) ? status : undefined,
    tier: TIERS.includes(tier) ? tier : undefined
  });
  res.json({ ok: true, submissions: rows });
});

app.patch('/api/admin/submissions/:id', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const cur = store.getSubmission(id);
  if (!cur) return res.status(404).json({ ok: false, error: 'Not found.' });

  const b = req.body || {};
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return res.status(400).json({ ok: false, error: 'Invalid status.' });
  }
  if (b.notes !== undefined && String(b.notes).length > 2000) {
    return res.status(400).json({ ok: false, error: 'Notes too long (≤2000 chars).' });
  }
  const row = store.updateSubmission(id, {
    status: b.status,
    notes: b.notes !== undefined ? String(b.notes) : undefined
  });

  // 免费档审核通过后立即跑一次回链校验，给出即时反馈
  if (row.tier === 'free' && row.status === 'approved') {
    try { await backlink.checkSubmission(row, store); } catch { /* 校验失败不影响审核 */ }
  }
  res.json({ ok: true, submission: store.getSubmission(id) });
});

app.post('/api/admin/submissions/:id/check', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const row = store.getSubmission(id);
  if (!row) return res.status(404).json({ ok: false, error: 'Not found.' });
  if (row.tier !== 'free') return res.json({ ok: true, status: 'not_required' });
  const result = await backlink.checkSubmission(row, store);
  res.json({ ok: true, result, submission: store.getSubmission(id) });
});

// ---------- 后台页面 + 静态 ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(STATIC_DIR));
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));

// ---------- 周期回链校验 ----------
if (cron.validate(CHECK_CRON)) {
  cron.schedule(CHECK_CRON, () => {
    backlink.runChecks(store).then((r) => {
      if (r.length) console.log(`[backlink] checked ${r.length} listing(s)`);
    }).catch((e) => console.error('[backlink] run error', e));
  });
  setTimeout(() => backlink.runChecks(store).catch(() => {}), 5000);
} else {
  console.warn('[backlink] invalid CHECK_CRON, scheduled checks disabled:', CHECK_CRON);
}

app.listen(PORT, () => {
  console.log(`waystone-backend listening on :${PORT}`);
  console.log(`static dir: ${STATIC_DIR}`);
  console.log(`admin: ${ADMIN_TOKEN ? 'enabled' : 'DISABLED (set ADMIN_TOKEN)'}`);
});
