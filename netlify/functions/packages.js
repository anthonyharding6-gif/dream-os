/**
 * Packages — bookable inventory.
 * Public: GET (active public packages)
 * Team:   GET all tiers, POST, PATCH, DELETE
 */
const { requireTeam, requireAdmin } = require('./_shared/auth');
const { getDb } = require('./_shared/db');
const { ok, err, preflight } = require('./_shared/response');
const { parseJson, isUuid, clamp } = require('./_shared/validate');

const VALID_TIERS = ['public', 'vip', 'private'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight(event);

  const sql = getDb();
  const id = event.path.split('/').filter(Boolean).pop();
  const validId = id && isUuid(id) ? id : null;

  if (event.httpMethod === 'GET') {
    const team = requireTeam(event);

    if (validId) {
      const where = team
        ? sql`where p.id = ${validId}`
        : sql`where p.id = ${validId} and p.tier = 'public' and p.active = true`;

      const rows = await sql`
        select p.*, v.name as venue_name, v.neighborhood
        from packages p
        left join venues_catalog v on v.id = p.venue_id
        ${where}
        limit 1
      `;
      if (!rows[0]) return err(event, 404, 'Package not found');
      return ok(event, rows[0]);
    }

    const { date, venue_id } = event.queryStringParameters || {};

    if (team) {
      const rows = await sql`
        select p.*, v.name as venue_name
        from packages p
        left join venues_catalog v on v.id = p.venue_id
        order by p.match_date asc, p.tier asc, p.name asc
      `;
      return ok(event, rows);
    }

    // Public: only active public packages
    const rows = await sql`
      select p.id, p.name, p.description, p.tier, p.price_cents,
             p.venue_id, p.match_date, p.capacity, p.available,
             v.name as venue_name, v.neighborhood
      from packages p
      left join venues_catalog v on v.id = p.venue_id
      where p.tier = 'public' and p.active = true and (p.available is null or p.available > 0)
      order by p.match_date asc, p.price_cents asc
    `;
    return ok(event, rows);
  }

  if (event.httpMethod === 'POST') {
    const user = requireTeam(event);
    if (!user) return err(event, 401, 'Unauthorized');

    const { data, error } = parseJson(event);
    if (error) return err(event, 400, error);

    if (!data?.name) return err(event, 400, 'name is required');
    if (data?.price_cents == null || typeof data.price_cents !== 'number') return err(event, 400, 'price_cents required');

    const tier = VALID_TIERS.includes(data?.tier) ? data.tier : 'public';

    const rows = await sql`
      insert into packages (name, description, tier, price_cents, venue_id, match_date, capacity, available)
      values (
        ${clamp(data.name, 120)},
        ${data.description ? clamp(data.description, 2000) : null},
        ${tier},
        ${data.price_cents},
        ${data.venue_id ? clamp(data.venue_id, 80) : null},
        ${data.match_date || null},
        ${data.capacity || null},
        ${data.available != null ? data.available : null}
      )
      returning *
    `;
    return ok(event, rows[0], 201);
  }

  if (event.httpMethod === 'PATCH') {
    const user = requireTeam(event);
    if (!user) return err(event, 401, 'Unauthorized');
    if (!validId) return err(event, 400, 'Package id required');

    const { data, error } = parseJson(event);
    if (error) return err(event, 400, error);

    const updates = {};
    if (data?.name) updates.name = clamp(data.name, 120);
    if (data?.description !== undefined) updates.description = data.description ? clamp(data.description, 2000) : null;
    if (data?.tier && VALID_TIERS.includes(data.tier)) updates.tier = data.tier;
    if (data?.price_cents != null) updates.price_cents = data.price_cents;
    if (data?.available != null) updates.available = data.available;
    if (data?.active !== undefined) updates.active = Boolean(data.active);

    if (!Object.keys(updates).length) return err(event, 400, 'No valid fields to update');

    const rows = await sql`
      update packages set ${sql(updates)}, updated_at = now()
      where id = ${validId} returning *
    `;
    if (!rows[0]) return err(event, 404, 'Package not found');
    return ok(event, rows[0]);
  }

  if (event.httpMethod === 'DELETE') {
    const user = requireAdmin(event);
    if (!user) return err(event, 401, 'Unauthorized');
    if (!validId) return err(event, 400, 'Package id required');

    await sql`update packages set active = false, updated_at = now() where id = ${validId}`;
    return ok(event, { ok: true });
  }

  return err(event, 405, 'Method not allowed');
};
