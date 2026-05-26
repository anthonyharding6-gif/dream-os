const { requireTeam, requireAdmin } = require('./_shared/auth');
const { getDb } = require('./_shared/db');
const { ok, err, preflight } = require('./_shared/response');
const { parseJson, isEmail, isUuid, clamp } = require('./_shared/validate');

const VALID_CATEGORIES = ['athlete', 'celeb', 'dj', 'corporate', 'media', 'other'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight(event);

  const sql = getDb();

  // GET /api/clients or GET /api/clients/:id
  if (event.httpMethod === 'GET') {
    const user = requireTeam(event);
    if (!user) return err(event, 401, 'Unauthorized');

    const id = event.path.split('/').pop();
    if (id && isUuid(id)) {
      const rows = await sql`
        select c.*, cp.status as presence_status, cp.city, cp.note as presence_note, cp.updated_at as presence_updated_at
        from clients c
        left join client_presence cp on cp.client_id = c.id
        where c.id = ${id}
        limit 1
      `;
      if (!rows[0]) return err(event, 404, 'Client not found');
      return ok(event, rows[0]);
    }

    const { category, status } = event.queryStringParameters || {};
    let rows;

    if (category && VALID_CATEGORIES.includes(category)) {
      rows = await sql`
        select c.id, c.name, c.email, c.phone, c.category, c.concierge_id, c.active, c.created_at,
               cp.status as presence_status, cp.city
        from clients c
        left join client_presence cp on cp.client_id = c.id
        where c.category = ${category} and c.active = true
        order by c.name asc
      `;
    } else if (status && ['live', 'away', 'unknown'].includes(status)) {
      rows = await sql`
        select c.id, c.name, c.email, c.phone, c.category, c.concierge_id, c.active, c.created_at,
               cp.status as presence_status, cp.city
        from clients c
        left join client_presence cp on cp.client_id = c.id
        where cp.status = ${status} and c.active = true
        order by cp.updated_at desc
      `;
    } else {
      rows = await sql`
        select c.id, c.name, c.email, c.phone, c.category, c.concierge_id, c.active, c.created_at,
               cp.status as presence_status, cp.city
        from clients c
        left join client_presence cp on cp.client_id = c.id
        where c.active = true
        order by c.name asc
      `;
    }
    return ok(event, rows);
  }

  // POST /api/clients — create
  if (event.httpMethod === 'POST') {
    const user = requireTeam(event);
    if (!user) return err(event, 401, 'Unauthorized');

    const { data, error } = parseJson(event);
    if (error) return err(event, 400, error);

    const name = clamp(data?.name, 120);
    if (!name) return err(event, 400, 'name is required');

    const email = data?.email ? clamp(data.email, 180).toLowerCase() : null;
    if (email && !isEmail(email)) return err(event, 400, 'invalid email');

    const category = VALID_CATEGORIES.includes(data?.category) ? data.category : 'other';

    const rows = await sql`
      insert into clients (name, email, phone, category, concierge_id, preferences, internal_notes)
      values (
        ${name},
        ${email},
        ${data?.phone ? clamp(data.phone, 80) : null},
        ${category},
        ${data?.concierge_id && isUuid(data.concierge_id) ? data.concierge_id : null},
        ${data?.preferences ? JSON.stringify(data.preferences) : '{}'},
        ${data?.internal_notes ? clamp(data.internal_notes, 8000) : null}
      )
      returning *
    `;
    return ok(event, rows[0], 201);
  }

  // PATCH /api/clients/:id — update
  if (event.httpMethod === 'PATCH') {
    const user = requireTeam(event);
    if (!user) return err(event, 401, 'Unauthorized');

    const id = event.path.split('/').pop();
    if (!isUuid(id)) return err(event, 400, 'Invalid client id');

    const { data, error } = parseJson(event);
    if (error) return err(event, 400, error);

    const updates = {};
    if (data?.name) updates.name = clamp(data.name, 120);
    if (data?.phone !== undefined) updates.phone = data.phone ? clamp(data.phone, 80) : null;
    if (data?.category && VALID_CATEGORIES.includes(data.category)) updates.category = data.category;
    if (data?.concierge_id !== undefined) updates.concierge_id = isUuid(data.concierge_id) ? data.concierge_id : null;
    if (data?.preferences) updates.preferences = JSON.stringify(data.preferences);
    if (data?.internal_notes !== undefined) updates.internal_notes = data.internal_notes ? clamp(data.internal_notes, 8000) : null;
    if (data?.active !== undefined && user.role === 'admin') updates.active = Boolean(data.active);

    if (!Object.keys(updates).length) return err(event, 400, 'No valid fields to update');

    const rows = await sql`
      update clients set ${sql(updates)}, updated_at = now()
      where id = ${id} returning *
    `;
    if (!rows[0]) return err(event, 404, 'Client not found');
    return ok(event, rows[0]);
  }

  // DELETE /api/clients/:id — soft delete (admin only)
  if (event.httpMethod === 'DELETE') {
    const user = requireAdmin(event);
    if (!user) return err(event, 401, 'Unauthorized');

    const id = event.path.split('/').pop();
    if (!isUuid(id)) return err(event, 400, 'Invalid client id');

    await sql`update clients set active = false, updated_at = now() where id = ${id}`;
    return ok(event, { ok: true });
  }

  return err(event, 405, 'Method not allowed');
};
