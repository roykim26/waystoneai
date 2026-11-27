'use strict';

// 提交事件通知：
//   1) notifyAdmin        —— 群机器人 webhook 推送给站长（飞书/钉钉/企业微信）
//   2) sendConfirmation   —— 通过 Resend REST API 给提交人发确认邮件
// 均基于 Node 18+ 内置 fetch，无新增依赖。失败只记日志，不影响提交主流程。

const WEBHOOK_URL = process.env.ADMIN_NOTIFY_WEBHOOK_URL || '';
// feishu | dingtalk | wecom
const WEBHOOK_TYPE = (process.env.ADMIN_NOTIFY_TYPE || 'feishu').toLowerCase();
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const SITE_URL = process.env.SITE_URL || 'https://waystoneai.online';

function buildAdminText(sub) {
  const tierLabel = sub.tier === 'founding' ? 'Founding（创始档）' : 'Free（免费档）';
  return [
    `【waystone 新提交 #${sub.id}】`,
    `工具：${sub.tool_name}`,
    `链接：${sub.product_url}`,
    `一句话：${sub.one_liner}`,
    `分类：${sub.category}`,
    `邮箱：${sub.email}`,
    `档位：${tierLabel}`,
    `时间：${sub.created_at}`,
    `后台：${SITE_URL}/admin`
  ].join('\n');
}

async function notifyAdmin(sub) {
  if (!WEBHOOK_URL) return;
  const text = buildAdminText(sub);
  let body;
  if (WEBHOOK_TYPE === 'dingtalk' || WEBHOOK_TYPE === 'wecom') {
    body = { msgtype: 'text', text: { content: text } };
  } else {
    body = { msg_type: 'text', content: { text } };
  }
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  const data = await res.json().catch(() => ({}));
  // 飞书返回 code，钉钉/企微返回 errcode；0 为成功
  const code = data.code !== undefined ? data.code : data.errcode;
  if (!res.ok || (code !== undefined && code !== 0)) {
    throw new Error(`webhook rejected: http=${res.status} resp=${JSON.stringify(data)}`);
  }
}

function confirmationHtml(sub) {
  const tierLabel = sub.tier === 'founding' ? 'Founding spot ($19 locked in)' : 'Free spot';
  return `<p>Hi,</p>
<p>Your reservation on <a href="${SITE_URL}">waystone ai</a> is confirmed.</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">
  <tr><td><b>Tool</b></td><td>${escapeHtml(sub.tool_name)}</td></tr>
  <tr><td><b>URL</b></td><td>${escapeHtml(sub.product_url)}</td></tr>
  <tr><td><b>Spot</b></td><td>${tierLabel}</td></tr>
  <tr><td><b>Ref</b></td><td>#${sub.id}</td></tr>
</table>
<p>We'll email you again as soon as listings open (within 7 days). No payment was taken now.</p>
<p>— The waystone ai team</p>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function sendConfirmation(sub) {
  if (!RESEND_API_KEY || !EMAIL_FROM) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [sub.email],
      subject: `Your waystone ai reservation #${sub.id} is confirmed`,
      html: confirmationHtml(sub)
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`resend http=${res.status} ${detail.slice(0, 300)}`);
  }
}

// 供 server.js 以 fire-and-forget 方式调用：返回 promise，由调用方 catch 记日志
module.exports = { notifyAdmin, sendConfirmation };
