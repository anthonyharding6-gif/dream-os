const crypto = require('crypto');
const { getDb } = require('./_shared/db');
const { signAccess, signRefresh } = require('./_shared/auth');
const { ok, err, preflight } = require('./_shared/response');
const { parseJson, isEmail, clamp } = require('./_shared/validate');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.JWT_SECRET).digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight(event);
  if (event.httpMethod !== 'POST') return err(event, 405, 'Method not allowed');

  const { data, error } = parseJson(event);
  if (error) return err(event, 400, error);

  const email = clamp(data?.email, 180).toLowerCase();
  const password = clamp(data?.password, 256);

  if (!isEmail(email) || !password) return err(event, 400, 'email and password required');

  const sql = getDb();
  const rows = await sql`
    select id, email, name, role, password_hash
    from users
    where email = ${email} and active = true
    limit 1
  `;

  const user = rows[0];
  if (!user) return err(event, 401, 'Invalid credentials');

  const hash = hashPassword(password);
  if (hash !== user.password_hash) return err(event, 401, 'Invalid credentials');

  const payload = { sub: user.id, email: user.email, name: user.name, role: user.role };
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh(payload);

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await sql`
    insert into sessions (user_id, token_hash, expires_at)
    values (${user.id}, ${tokenHash}, ${expiresAt})
  `;

  return ok(event, {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
};
