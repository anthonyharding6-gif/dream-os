/**
 * Bookings — both public self-serve and concierge-managed.
 *
 * POST /api/bookings          → create booking (public or team)
 * GET  /api/bookings          → list (team only)
 * GET  /api/bookings/:id      → single booking (team only)
 * PATCH /api/bookings/:id     → update status (team only)
 */
const { requireTeam, requireAuth } = require('./_shared/auth');
const { getDb } = require('./_shared/db');
const { ok, err, preflight } = require('./_shared/response');
const { parseJson, isEmail, isUuid, clamp } = require('./_shared/validate');

const RATE_LIMIT = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const window = 60_000;
  const max = 5;
  const hits = (RATE_LIMIT.get(ip) || []).filter((t) => now - t < window);
  if (hits.length >= max) return true;
  hits.push(now);
  RATE_LIMIT.set(ip, hits);
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight(event);

  const sql = getDb();
  const segments = event.path.replace(/^\/api\/bookings\/?/, '').split('/').filter(Boolean);
  const id = segments[0] && isUuid(segments[0]) ? segments[0] : null;

  if (event.httpMethod === 'GET') {
    const user = requireTeam(event);
    if (!user) return err(event, 401, 'Unauthorized');

    if (id) {
      const rows = await sql`
        select b.*, p.name as package_name, p.match_date, v.name as venue_name
        from bookings b
        left join packages p on p.id = b.package_id
        left join venues_catalog v on v.id = p.venue_id
        where b.id = ${id}
        limit 1
      `;
      if (!rows[0]) return err(event, 404, 'Booking not found');
      return ok(event, rows[0]);
    }

    const { status, tier } = event.queryStringParameters || {};
    const rows = status
      ? await sql`
          select b.*, p.name as package_name, p.match_date
          from bookings b
          left join packages p on p.id = b.package_id
          where b.status = ${status}
          order by b.created_at desc limit 500
        `
      : await sql`
          select b.*, p.name as package_name, p.match_date
          from bookings b
          left join packages p on p.id = b.package_id
          order by b.created_at desc limit 500
        `;
    return ok(event, rows);
  }

  if (event.httpMethod === 'POST') {
    const { data, error } = parseJson(event);
    if (error) return err(event, 400, error);

    const team = requireTeam(event);

    // Public bookings get rate-limited
    if (!team) {
      const ip = event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      if (rateLimited(ip)) return err(event, 429, 'Too many requests');
    }

    const packageId = data?.package_id;
    if (!packageId || !isUuid(packageId)) return err(event, 400, 'package_id required');

    // Verify package exists and has availability
    const pkgRows = await sql`select * from packages where id = ${packageId} and active = true limit 1`;
    const pkg = pkgRows[0];
    if (!pkg) return err(event, 404, 'Package not found');
    if (pkg.available != null && pkg.available <= 0) return err(event, 409, 'Package is sold out');

    // For public bookings, only allow public tier packages
    if (!team && pkg.tier !== 'public') return err(event, 403, 'This package requires concierge access');

    const guestName = clamp(data?.guest_name || data?.name, 120);
    const guestEmail = clamp(data?.guest_email || data?.email, 180).toLowerCase();
    if (!guestName) return err(event, 400, 'guest_name required');
    if (!isEmail(guestEmail)) return err(event, 400, 'valid guest_email required');

    const partySize = Math.min(Math.max(parseInt(data?.party_size) || 1, 1), 500);
    const tier = team ? (data?.tier || 'vip') : 'public';
    const clientId = team && data?.client_id && isUuid(data.client_id) ? data.client_id : null;

    const rows = await sql`
      insert into bookings (package_id, client_id, guest_name, guest_email, guest_phone, party_size, status, tier, notes, concierge_id)
      values (
        ${packageId},
        ${clientId},
        ${guestName},
        ${guestEmail},
        ${data?.guest_phone ? clamp(data.guest_phone, 80) : null},
        ${partySize},
        'pending',
        ${tier},
        ${data?.notes ? clamp(data.notes, 4000) : null},
        ${team ? team.sub : null}
      )
      returning *
    `;

    // Decrement availability
    if (pkg.available != null) {
      await sql`update packages set available = available - 1 where id = ${packageId}`;
    }

    return ok(event, rows[0], 201);
  }

  if (event.httpMethod === 'PATCH') {
    const user = requireTeam(event);
    if (!user) return err(event, 401, 'Unauthorized');
    if (!id) return err(event, 400, 'Booking id required');

    const { data, error } = parseJson(event);
    if (error) return err(event, 400, error);

    const updates = {};
    if (data?.status && ['pending', 'confirmed', 'cancelled'].includes(data.status)) updates.status = data.status;
    if (data?.notes !== undefined) updates.notes = data.notes ? clamp(data.notes, 4000) : null;
    if (data?.concierge_id && isUuid(data.concierge_id)) updates.concierge_id = data.concierge_id;

    if (!Object.keys(updates).length) return err(event, 400, 'No valid fields to update');

    const rows = await sql`
      update bookings set ${sql(updates)}, updated_at = now()
      where id = ${id} returning *
    `;
    if (!rows[0]) return err(event, 404, 'Booking not found');
    return ok(event, rows[0]);
  }

  return err(event, 405, 'Method not allowed');
};
