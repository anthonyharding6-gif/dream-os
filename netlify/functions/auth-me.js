const { requireAuth } = require('./_shared/auth');
const { ok, err, preflight } = require('./_shared/response');
const { getDb } = require('./_shared/db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight(event);
  if (event.httpMethod !== 'GET') return err(event, 405, 'Method not allowed');

  const user = requireAuth(event);
  if (!user) return err(event, 401, 'Unauthorized');

  const sql = getDb();
  const rows = await sql`
    select id, email, name, role, created_at
    from users where id = ${user.sub} and active = true limit 1
  `;

  if (!rows[0]) return err(event, 401, 'Unauthorized');
  return ok(event, rows[0]);
};
