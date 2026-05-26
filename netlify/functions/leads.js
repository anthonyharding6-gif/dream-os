const nodemailer = require('nodemailer');
const brand = require('./lib/brand/config');
const { requireTeam } = require('./_shared/auth');
const { ok, err, preflight } = require('./_shared/response');
const { parseJson, isEmail, clamp } = require('./_shared/validate');
const { getDb, isDbConfigured } = require('./_shared/db');
const { escapeHtml } = require('./_shared/sanitize');

const fallbackLeads = [];
const RATE_LIMIT = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const window = 60_000;
  const max = 6;
  const hits = (RATE_LIMIT.get(ip) || []).filter((t) => now - t < window);
  if (hits.length >= max) return true;
  hits.push(now);
  RATE_LIMIT.set(ip, hits);
  return false;
}

function validate(body) {
  if (!body?.name || !body?.email) return 'name and email are required';
  if (clamp(body.name, 121).length > 120) return 'name too long';
  if (!isEmail(body.email)) return 'invalid email';
  if (body.details && String(body.details).length > 12000) return 'details too long';
  return null;
}

async function notifyInternal(lead) {
  const to = process.env.VIP_LEADS_NOTIFY_EMAIL || 'anthonyharding6@gmail.com';
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  const safeName = String(lead.name || '').replace(/[\r\n]/g, ' ').slice(0, 200);
  const text = [
    'New VIP access request',
    '',
    `Name:   ${lead.name}`,
    `Email:  ${lead.email}`,
    lead.phone   ? `Phone:  ${lead.phone}` : null,
    lead.group_size ? `Group:  ${lead.group_size}` : null,
    lead.category ? `Type:   ${lead.category}` : null,
    `Source: ${lead.source || 'landing'}`,
    '',
    '--- Details ---',
    lead.details || '(none)',
  ].filter(Boolean).join('\n');

  await transporter.sendMail({
    from: `"${brand.emailSenderName}" <${process.env.EMAIL_USER}>`,
    to,
    subject: `New VIP lead: ${safeName}`,
    text,
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`,
    replyTo: lead.email,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight(event);

  const sql = isDbConfigured() ? getDb() : null;

  if (event.httpMethod === 'GET') {
    const user = requireTeam(event);
    if (!user) return err(event, 401, 'Unauthorized');

    if (!sql) return ok(event, { mode: 'fallback', items: fallbackLeads });

    const rows = await sql`
      select * from vip_leads order by created_at desc limit 500
    `;
    return ok(event, { mode: 'db', items: rows });
  }

  if (event.httpMethod === 'POST') {
    const { data, error } = parseJson(event);
    if (error) return err(event, 400, error);

    const validationError = validate(data);
    if (validationError) return err(event, 400, validationError);

    const ip = event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    if (rateLimited(ip)) return err(event, 429, 'Too many requests');

    const lead = {
      name:       clamp(data.name, 120),
      email:      clamp(data.email, 180).toLowerCase(),
      phone:      data.phone      ? clamp(data.phone, 80)       : null,
      details:    data.details    ? String(data.details).slice(0, 12000) : null,
      source:     data.source     ? clamp(data.source, 64)      : 'landing',
      group_size: data.group_size ? clamp(data.group_size, 40)  : null,
      category:   data.category   ? clamp(data.category, 64)    : null,
    };

    if (!sql) {
      fallbackLeads.push(lead);
      notifyInternal(lead).catch((e) => console.error('[leads:notify]', e));
      return ok(event, { mode: 'fallback', item: lead });
    }

    const rows = await sql`
      insert into vip_leads (name, email, phone, details, source, group_size, category)
      values (${lead.name}, ${lead.email}, ${lead.phone}, ${lead.details}, ${lead.source}, ${lead.group_size}, ${lead.category})
      returning *
    `;

    notifyInternal(rows[0]).catch((e) => console.error('[leads:notify]', e));
    return ok(event, { mode: 'db', item: rows[0] });
  }

  return err(event, 405, 'Method not allowed');
};
