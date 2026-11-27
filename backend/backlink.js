'use strict';

// 免费档回链校验：抓取工具站 product_url，检测是否存在指向 BACKLINK_DOMAIN 的链接。
// 仅做轻量 HTML 锚点解析（正则），适配预售期小批量；上千条后可换 cheerio/专用爬虫。

const BACKLINK_DOMAIN = (process.env.BACKLINK_DOMAIN || 'waystoneai.online').toLowerCase();
const GRACE_DAYS = Number(process.env.GRACE_DAYS || 7);
const UA = 'WaystoneAI-BacklinkChecker/1.0 (+https://waystoneai.online)';

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    return text.slice(0, 2_000_000); // 上限 2MB，避免超大页面
  } finally {
    clearTimeout(timer);
  }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

function hostMatches(href) {
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return host === BACKLINK_DOMAIN || host.endsWith('.' + BACKLINK_DOMAIN);
  } catch {
    return false;
  }
}

// 返回 { found, href, rel }
function findBacklink(html) {
  const re = /<a\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const href = attr(tag, 'href');
    if (href && hostMatches(href)) {
      return { found: true, href, rel: attr(tag, 'rel') || '' };
    }
  }
  return { found: false, href: null, rel: null };
}

async function checkUrl(productUrl) {
  const html = await fetchHtml(productUrl);
  return findBacklink(html);
}

// 校验单条并写库。网络/抓取错误时不翻转状态，避免误判下架。
async function checkSubmission(row, store) {
  const ts = store.now();
  let result;
  try {
    result = await checkUrl(row.product_url);
  } catch (err) {
    store.updateBacklink(row.id, {
      backlink_status: row.backlink_status,
      backlink_href: row.backlink_href,
      backlink_rel: row.backlink_rel,
      last_checked_at: ts,
      missing_since: row.missing_since
    });
    return { id: row.id, ok: false, error: String(err.message || err) };
  }

  if (result.found) {
    store.updateBacklink(row.id, {
      backlink_status: 'detected',
      backlink_href: result.href,
      backlink_rel: result.rel,
      last_checked_at: ts,
      missing_since: null
    });
    return { id: row.id, ok: true, status: 'detected', rel: result.rel };
  }

  // 缺失：记录首次缺失时间，宽限期内 grace，超期 missing
  const missingSince = row.missing_since || ts;
  const elapsedDays = (Date.now() - new Date(missingSince).getTime()) / 86400000;
  const status = elapsedDays < GRACE_DAYS ? 'grace' : 'missing';
  store.updateBacklink(row.id, {
    backlink_status: status,
    backlink_href: null,
    backlink_rel: null,
    last_checked_at: ts,
    missing_since: missingSince
  });
  return { id: row.id, ok: true, status };
}

async function runChecks(store) {
  const rows = store.pendingBacklinkChecks();
  const results = [];
  for (const row of rows) {
    results.push(await checkSubmission(row, store));
  }
  return results;
}

module.exports = { checkUrl, checkSubmission, runChecks, findBacklink };
