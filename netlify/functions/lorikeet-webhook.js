/**
 * Lorikeet → Dream OS webhook receiver
 *
 * Lorikeet POSTs signed events here whenever a conversation completes
 * or a significant action occurs (booking created, lead captured, handoff requested).
 *
 * Set LORIKEET_WEBHOOK_SECRET in Netlify env vars to the secret Lorikeet
 * provides during onboarding. Every inbound request is HMAC-verified.
 *
 * Lorikeet dashboard → Settings → Webhooks → Endpoint: https://dream-os-2026.netlify.app/api/lorikeet/webhook
 */

const crypto = require('crypto');
const { getDb, isDbConfigured } = require('./_shared/db');
const { ok, err } = require('./_shared/response');
const { escapeHtml } = require('./_shared/sanitize');
const nodemailer = require('nodemailer');

// ── Signature verification ─────────────────────────────────────────────────
function verifySignature(event) {
  const secret = process.env.LORIKEET_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured — allow in dev, block in prod
    if (process.env.NODE_ENV === 'production') return false;
    console.warn('[lorikeet-webhook] LORIKEET_WEBHOOK_SECRET not set — skipping verification in dev');
    return true;
  }

  // Lorikeet sends HMAC-SHA256 in X-Lorikeet-Signature header (hex)
  const signature = event.headers?.['x-lorikeet-signature'] || '';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(event.body || '')
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex').length ? Buffer.from(signature, 'hex') : Buffer.alloc(32),
    Buffer.from(expected, 'hex')
  );
}

// ── Email alert ────────────────────────────────────────────────────────────
async function sendAlert(subject, body) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from: `"Dream OS" <${process.env.EMAIL_USER}>`,
    to: process.env.VIP_LEADS_NOTIFY_EMAIL || 'anthonyharding6@gmail.com',
    subject,
    text: body,
    html: `<pre style="font-family:monospace;font-size:13px">${escapeHtml(body)}</pre>`,
  });
}

// ── Event handlers ─────────────────────────────────────────────────────────

async function handleConversationComplete(payload, sql) {
  const { conversation_id, channel, customer, summary, outcome, duration_seconds } = payload;

  const record = {
    source:      `lorikeet:${channel || 'unknown'}`,
    name:        customer?.name  || 'Unknown',
    email:       customer?.email || null,
    phone:       customer?.phone || null,
    details:     summary || null,
    category:    outcome  || null,
  };

  if (sql) {
    await sql`
      insert into vip_leads (name, email, phone, details, source, category)
      values (${record.name}, ${record.email}, ${record.phone}, ${record.details}, ${record.source}, ${record.category})
      on conflict do nothing
    `;
  }

  const alertBody = [
    `Lorikeet conversation completed`,
    ``,
    `Channel:    ${channel}`,
    `Customer:   ${record.name} ${record.email ? `<${record.email}>` : ''} ${record.phone || ''}`,
    `Outcome:    ${outcome || 'n/a'}`,
    `Duration:   ${duration_seconds ? `${Math.round(duration_seconds)}s` : 'n/a'}`,
    ``,
    `Summary:`,
    summary || '(none)',
  ].join('\n');

  await sendAlert(`[Dream OS] Lorikeet conversation — ${outcome || 'completed'}`, alertBody).catch(console.error);
}

async function handleBookingIntent(payload, sql) {
  const { customer, venue, date, party_size, notes, channel, conversation_id } = payload;

  const record = {
    source:      `lorikeet:${channel || 'unknown'}`,
    name:        customer?.name  || 'Unknown',
    email:       customer?.email || null,
    phone:       customer?.phone || null,
    details:     [
      venue     ? `Venue: ${venue}` : null,
      date      ? `Date: ${date}` : null,
      party_size ? `Party: ${party_size}` : null,
      notes     ? `Notes: ${notes}` : null,
    ].filter(Boolean).join('\n'),
    category:   'booking_intent',
  };

  if (sql) {
    await sql`
      insert into vip_leads (name, email, phone, details, source, category)
      values (${record.name}, ${record.email}, ${record.phone}, ${record.details}, ${record.source}, ${record.category})
    `;
  }

  const alertBody = [
    `Lorikeet booking intent captured`,
    ``,
    `Channel:    ${channel}`,
    `Customer:   ${record.name} ${record.email ? `<${record.email}>` : ''} ${record.phone || ''}`,
    `Venue:      ${venue || 'n/a'}`,
    `Date:       ${date || 'n/a'}`,
    `Party size: ${party_size || 'n/a'}`,
    `Notes:      ${notes || 'n/a'}`,
    `Conv ID:    ${conversation_id || 'n/a'}`,
  ].join('\n');

  await sendAlert(`[Dream OS] New booking intent — ${venue || 'venue TBD'}`, alertBody).catch(console.error);
}

async function handleHumanHandoff(payload, sql) {
  const { customer, channel, reason, conversation_id, transcript_url } = payload;

  const alertBody = [
    `Lorikeet requesting human handoff`,
    ``,
    `Channel:    ${channel}`,
    `Customer:   ${customer?.name || 'Unknown'} ${customer?.phone || customer?.email || ''}`,
    `Reason:     ${reason || 'n/a'}`,
    `Conv ID:    ${conversation_id}`,
    transcript_url ? `Transcript: ${transcript_url}` : null,
    ``,
    `ACTION REQUIRED: Follow up with this customer immediately.`,
  ].filter(Boolean).join('\n');

  await sendAlert(`[Dream OS] ⚡ Human handoff needed — ${channel}`, alertBody).catch(console.error);
}

async function handleMembershipInquiry(payload, sql) {
  const { customer, tier, channel } = payload;

  const record = {
    source:   `lorikeet:${channel}:membership`,
    name:     customer?.name  || 'Unknown',
    email:    customer?.email || null,
    phone:    customer?.phone || null,
    details:  `Membership inquiry via ${channel}. Tier interest: ${tier || 'unspecified'}`,
    category: 'membership',
  };

  if (sql) {
    await sql`
      insert into vip_leads (name, email, phone, details, source, category)
      values (${record.name}, ${record.email}, ${record.phone}, ${record.details}, ${record.source}, ${record.category})
    `;
  }

  const alertBody = [
    `Membership inquiry via Lorikeet`,
    ``,
    `Channel:  ${channel}`,
    `Customer: ${record.name} ${record.email ? `<${record.email}>` : ''} ${record.phone || ''}`,
    `Tier:     ${tier || 'unspecified'}`,
  ].join('\n');

  await sendAlert(`[Dream OS] Membership inquiry — ${tier || 'unknown tier'}`, alertBody).catch(console.error);
}

// ── Main handler ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!verifySignature(event)) {
    console.error('[lorikeet-webhook] Signature verification failed');
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { event: eventType } = payload;
  if (!eventType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing event type' }) };
  }

  const sql = isDbConfigured() ? getDb() : null;

  try {
    switch (eventType) {
      case 'conversation.completed':
        await handleConversationComplete(payload, sql);
        break;
      case 'booking.intent':
        await handleBookingIntent(payload, sql);
        break;
      case 'handoff.requested':
        await handleHumanHandoff(payload, sql);
        break;
      case 'membership.inquiry':
        await handleMembershipInquiry(payload, sql);
        break;
      default:
        // Log unknown events but don't error — Lorikeet may add new types
        console.log(`[lorikeet-webhook] Unhandled event type: ${eventType}`, JSON.stringify(payload).slice(0, 500));
    }

    return { statusCode: 200, body: JSON.stringify({ received: true, event: eventType }) };
  } catch (e) {
    console.error('[lorikeet-webhook] Handler error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
