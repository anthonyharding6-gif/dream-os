const crypto = require('crypto');
const { authenticate } = require('./_shared/auth');
const { getDb } = require('./_shared/db');
const { ok, err, preflight } = require('./_shared/response');
const { parseJson } = require('./_shared/validate');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight(event);
  if (event.httpMethod !== 'POST') return err(event, 405, 'Method not allowed');

  const { data } = parseJson(event);
  const refreshToken = data?.refresh_token;

  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const sql = getDb();
    await sql`delete from sessions where token_hash = ${tokenHash}`;
  }

  return ok(event, { ok: true });
};
