/**
 * Client presence — live/away status (the "Slack status" for A-list clients).
 *
 * GET  /api/presence          → all clients with status (team only)
 * GET  /api/presence/:id      → single client presence
 * POST /api/presence/:id      → set status for a client
 */
const { requireTeam } = require('./_shared/auth');
const { getDb } = require('./_shared/db');
const { ok, err, preflight } = require('./_shared/response');
const { parseJson, isUuid, clamp } = require('./_shared/validate');

const VALID_STATUSES = ['live', 'away', 'unknown'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight(event);

  const user = requireTeam(event);
  if (!user) return err(event, 401, 'Unauthorized');

  const sql = getDb();
  const segments = event.path.replace(/^\/api\/presence\/?/, '').split('/').filter(Boolean);
  const clientId = segments[0];

  if (event.httpMethod === 'GET') {
    if (clientId && isUuid(clientId)) {
      const rows = await sql`
        select cp.*, c.name, c.category
        from client_presence cp
        join clients c on c.id = cp.client_id
        where cp.client_id = ${clientId}
        limit 1
      `;
      if (!rows[0]) return err(event, 404, 'Not found');
      return ok(event, rows[0]);
    }

    // Full roster with presence
    const rows = await sql`
      select c.id, c.name, c.category, c.phone,
             coalesce(cp.status, 'unknown') as status,
             cp.city, cp.note, cp.updated_at
      from clients c
      left join client_presence cp on cp.client_id = c.id
      where c.active = true
      order by
        case coalesce(cp.status,'unknown')
          when 'live'    then 1
          when 'unknown' then 2
          when 'away'    then 3
        end,
        c.name asc
    `;
    return ok(event, rows);
  }

  if (event.httpMethod === 'POST') {
    if (!clientId || !isUuid(clientId)) return err(event, 400, 'Client id required');

    const { data, error } = parseJson(event);
    if (error) return err(event, 400, error);

    const status = data?.status;
    if (!VALID_STATUSES.includes(status)) return err(event, 400, `status must be one of: ${VALID_STATUSES.join(', ')}`);

    const city = data?.city ? clamp(data.city, 100) : null;
    const note = data?.note ? clamp(data.note, 500) : null;

    await sql`
      insert into client_presence (client_id, status, city, note, updated_by, updated_at)
      values (${clientId}, ${status}, ${city}, ${note}, ${user.sub}, now())
      on conflict (client_id) do update set
        status     = excluded.status,
        city       = excluded.city,
        note       = excluded.note,
        updated_by = excluded.updated_by,
        updated_at = now()
    `;

    return ok(event, { ok: true, client_id: clientId, status, city, note });
  }

  return err(event, 405, 'Method not allowed');
};
