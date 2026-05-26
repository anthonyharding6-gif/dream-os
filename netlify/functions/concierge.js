/**
 * Concierge tools — notes, assignments, client activity.
 *
 * GET  /api/concierge/notes/:clientId   → notes for a client
 * POST /api/concierge/notes/:clientId   → add note
 * GET  /api/concierge/roster            → full concierge roster view
 */
const { requireTeam } = require('./_shared/auth');
const { getDb } = require('./_shared/db');
const { ok, err, preflight } = require('./_shared/response');
const { parseJson, isUuid, clamp } = require('./_shared/validate');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight(event);

  const user = requireTeam(event);
  if (!user) return err(event, 401, 'Unauthorized');

  const sql = getDb();

  // Strip /api/concierge/ prefix
  const subpath = event.path.replace(/^\/api\/concierge\/?/, '');
  const segments = subpath.split('/').filter(Boolean);
  const section = segments[0]; // 'notes' | 'roster'
  const param = segments[1];   // clientId for notes

  // GET /api/concierge/roster
  if (event.httpMethod === 'GET' && section === 'roster') {
    const rows = await sql`
      select c.id, c.name, c.category, c.phone, c.email,
             u.name as concierge_name,
             coalesce(cp.status, 'unknown') as presence_status,
             cp.city,
             (select count(*) from bookings b where b.client_id = c.id and b.status != 'cancelled') as booking_count
      from clients c
      left join users u on u.id = c.concierge_id
      left join client_presence cp on cp.client_id = c.id
      where c.active = true
      order by
        case coalesce(cp.status, 'unknown')
          when 'live'    then 1
          when 'unknown' then 2
          when 'away'    then 3
        end,
        c.name asc
    `;
    return ok(event, rows);
  }

  // GET /api/concierge/notes/:clientId
  if (event.httpMethod === 'GET' && section === 'notes') {
    if (!param || !isUuid(param)) return err(event, 400, 'Client id required');

    const rows = await sql`
      select n.*, u.name as author_name
      from concierge_notes n
      left join users u on u.id = n.author_id
      where n.client_id = ${param}
      order by n.created_at desc
      limit 200
    `;
    return ok(event, rows);
  }

  // POST /api/concierge/notes/:clientId
  if (event.httpMethod === 'POST' && section === 'notes') {
    if (!param || !isUuid(param)) return err(event, 400, 'Client id required');

    const { data, error } = parseJson(event);
    if (error) return err(event, 400, error);

    const body = clamp(data?.body || data?.note, 8000);
    if (!body) return err(event, 400, 'body required');

    const rows = await sql`
      insert into concierge_notes (client_id, body, author_id)
      values (${param}, ${body}, ${user.sub})
      returning *
    `;
    return ok(event, rows[0], 201);
  }

  return err(event, 404, 'Not found');
};
