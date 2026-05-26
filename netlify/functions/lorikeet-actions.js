/**
 * Lorikeet Actions API
 *
 * Lorikeet calls these endpoints mid-conversation to perform real actions:
 *   POST /api/lorikeet/actions/booking      → create a reservation
 *   POST /api/lorikeet/actions/lookup       → look up a customer by phone/email
 *   POST /api/lorikeet/actions/availability → check venue availability
 *   POST /api/lorikeet/actions/lead         → capture a VIP lead
 *
 * All requests must carry:
 *   Authorization: Bearer <LORIKEET_API_KEY>   (set in Netlify env)
 *
 * Lorikeet dashboard → Settings → Integrations → Custom API
 * Base URL: https://dream-os-2026.netlify.app/api/lorikeet/actions
 */

const crypto = require('crypto');
const { getDb, isDbConfigured } = require('./_shared/db');
const { escapeHtml } = require('./_shared/sanitize');
const nodemailer = require('nodemailer');

// ── Auth: verify Lorikeet's API key ───────────────────────────────────────
function verifyLorikeetKey(event) {
  const expected = process.env.LORIKEET_API_KEY;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return false;
    console.warn('[lorikeet-actions] LORIKEET_API_KEY not set — skipping auth in dev');
    return true;
  }
  const header = event.headers?.['authorization'] || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  return crypto.timingSafeEqual(
    Buffer.from(provided.padEnd(64)),
    Buffer.from(expected.padEnd(64))
  );
}

function json(statusCode, data) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

// ── Email alert (shared) ───────────────────────────────────────────────────
async function sendAlert(subject, text) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from: `"Dream OS" <${process.env.EMAIL_USER}>`,
    to: process.env.VIP_LEADS_NOTIFY_EMAIL || 'anthonyharding6@gmail.com',
    subject,
    text,
    html: `<pre style="font-family:monospace;font-size:13px">${escapeHtml(text)}</pre>`,
  });
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * POST /api/lorikeet/actions/booking
 * Body: { name, email, phone, venue, date, party_size, notes, channel, conversation_id }
 * Returns: { success, booking_id, message }
 */
async function createBooking(body, sql) {
  const { name, email, phone, venue, date, party_size, notes, channel, conversation_id } = body;

  if (!name || !venue) {
    return json(400, { success: false, error: 'name and venue are required' });
  }

  const details = [
    venue      ? `Venue: ${venue}` : null,
    date       ? `Date: ${date}` : null,
    party_size ? `Party size: ${party_size}` : null,
    notes      ? `Notes: ${notes}` : null,
    channel    ? `Via: ${channel}` : null,
  ].filter(Boolean).join('\n');

  let bookingId = `BK-${Date.now()}`;

  if (sql) {
    const rows = await sql`
      insert into vip_leads (name, email, phone, details, source, category)
      values (
        ${name},
        ${email || null},
        ${phone || null},
        ${details},
        ${`lorikeet:${channel || 'voice'}`},
        ${'booking_intent'}
      )
      returning id
    `;
    bookingId = `BK-${rows[0]?.id || Date.now()}`;
  }

  // Alert the team immediately
  await sendAlert(
    `[Dream OS] ⚡ New Lorikeet booking — ${venue}`,
    [
      `Booking captured via Lorikeet AI (${channel || 'voice'})`,
      ``,
      `Customer:   ${name}`,
      `Email:      ${email || 'n/a'}`,
      `Phone:      ${phone || 'n/a'}`,
      `Venue:      ${venue}`,
      `Date:       ${date || 'n/a'}`,
      `Party:      ${party_size || 'n/a'}`,
      `Notes:      ${notes || 'n/a'}`,
      `Conv ID:    ${conversation_id || 'n/a'}`,
      `Booking ID: ${bookingId}`,
    ].join('\n')
  ).catch(console.error);

  return json(200, {
    success: true,
    booking_id: bookingId,
    message: `Reservation request confirmed for ${name} at ${venue}${date ? ` on ${date}` : ''}. Our team will follow up within 2 hours.`,
  });
}

/**
 * POST /api/lorikeet/actions/lookup
 * Body: { phone?, email?, conversation_id }
 * Returns: { found, customer? }
 *
 * Lorikeet uses this to personalize the conversation —
 * "Welcome back, Marcus. I see you have a suite at Harbor on June 12."
 */
async function lookupCustomer(body, sql) {
  const { phone, email } = body;

  if (!phone && !email) {
    return json(400, { success: false, error: 'phone or email required' });
  }

  if (!sql) {
    // No DB yet — return not found gracefully
    return json(200, { found: false });
  }

  let rows = [];
  if (email) {
    rows = await sql`
      select id, name, email, phone, category, created_at
      from vip_leads
      where lower(email) = ${email.toLowerCase()}
      order by created_at desc
      limit 1
    `;
  } else if (phone) {
    rows = await sql`
      select id, name, email, phone, category, created_at
      from vip_leads
      where phone = ${phone}
      order by created_at desc
      limit 1
    `;
  }

  if (!rows.length) return json(200, { found: false });

  const c = rows[0];
  return json(200, {
    found: true,
    customer: {
      id:         c.id,
      name:       c.name,
      email:      c.email,
      phone:      c.phone,
      tier:       c.category === 'membership' ? 'member' : 'guest',
      last_seen:  c.created_at,
    },
  });
}

/**
 * POST /api/lorikeet/actions/availability
 * Body: { venue, date?, party_size? }
 * Returns: { available, message, next_available? }
 *
 * For now returns a static "contact to confirm" response
 * since we don't have a live availability engine yet.
 * Swap out the response once a calendar/booking system is connected.
 */
async function checkAvailability(body) {
  const { venue, date, party_size } = body;

  if (!venue) return json(400, { success: false, error: 'venue is required' });

  // Static responses per venue type — swap for real calendar logic when ready
  const venueMap = {
    'harbor':      { type: 'nightclub', note: 'Table reservations open Thursday–Saturday. Minimum spend applies.' },
    'nebula':      { type: 'nightclub', note: 'Table reservations open Friday–Sunday. Contact for bottle service.' },
    'phd':         { type: 'rooftop',   note: 'Rooftop reservations available daily. Weather permitting.' },
    'petite':      { type: 'intimate',  note: 'Petite is invitation-only. Subject to host approval.' },
    'sei less':    { type: 'restaurant', note: 'Dinner reservations available Tuesday–Sunday.' },
    'pappas':      { type: 'restaurant', note: 'Reservations available daily for lunch and dinner.' },
    'tucci':       { type: 'restaurant', note: 'Dinner reservations available Wednesday–Sunday.' },
    'gyro city':   { type: 'fast_casual', note: 'Walk-in only. No reservations needed.' },
  };

  const key = Object.keys(venueMap).find(k => venue.toLowerCase().includes(k));
  const info = venueMap[key] || { note: 'Contact us to check availability at this venue.' };

  return json(200, {
    available: true,
    venue,
    date:    date || null,
    message: `${info.note}${party_size ? ` Your party of ${party_size} can be accommodated.` : ''} Our team will confirm details within 2 hours.`,
    action:  'REQUEST_BOOKING',
  });
}

/**
 * POST /api/lorikeet/actions/lead
 * Body: { name, email, phone, interest, notes, tier, channel }
 * Used when Lorikeet captures a VIP or membership inquiry
 */
async function captureLead(body, sql) {
  const { name, email, phone, interest, notes, tier, channel } = body;

  if (!name) return json(400, { success: false, error: 'name is required' });

  const details = [
    interest ? `Interest: ${interest}` : null,
    tier     ? `Tier: ${tier}` : null,
    notes    ? `Notes: ${notes}` : null,
  ].filter(Boolean).join('\n');

  if (sql) {
    await sql`
      insert into vip_leads (name, email, phone, details, source, category)
      values (
        ${name},
        ${email || null},
        ${phone || null},
        ${details || null},
        ${`lorikeet:${channel || 'unknown'}`},
        ${tier === 'black' ? 'membership_black' : tier === 'founders' ? 'membership_founders' : 'lead'}
      )
    `;
  }

  await sendAlert(
    `[Dream OS] New Lorikeet lead — ${name}`,
    [
      `Lead captured via Lorikeet (${channel || 'unknown'})`,
      ``,
      `Name:     ${name}`,
      `Email:    ${email || 'n/a'}`,
      `Phone:    ${phone || 'n/a'}`,
      `Interest: ${interest || 'n/a'}`,
      `Tier:     ${tier || 'n/a'}`,
      `Notes:    ${notes || 'n/a'}`,
    ].join('\n')
  ).catch(console.error);

  return json(200, {
    success: true,
    message: `Got it, ${name}. Our team will be in touch within a few hours.`,
  });
}

// ── Router ─────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }, body: '' };
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  if (!verifyLorikeetKey(event)) return json(401, { error: 'Unauthorized' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const sql = isDbConfigured() ? getDb() : null;

  // Route by path: /api/lorikeet/actions/:action
  const path = event.path || '';
  const action = path.split('/').pop();

  try {
    switch (action) {
      case 'booking':      return await createBooking(body, sql);
      case 'lookup':       return await lookupCustomer(body, sql);
      case 'availability': return await checkAvailability(body);
      case 'lead':         return await captureLead(body, sql);
      default:
        return json(404, { error: `Unknown action: ${action}`, available: ['booking', 'lookup', 'availability', 'lead'] });
    }
  } catch (e) {
    console.error('[lorikeet-actions] Error:', e);
    return json(500, { error: 'Internal error' });
  }
};
