const jwt = require('jsonwebtoken');

const JWT_SECRET = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return process.env.JWT_SECRET;
};

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

function signAccess(payload) {
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: ACCESS_TTL });
}

function signRefresh(payload) {
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: REFRESH_TTL });
}

function verifyToken(token) {
  try {
    return { decoded: jwt.verify(token, JWT_SECRET()), error: null };
  } catch (e) {
    return { decoded: null, error: e.message };
  }
}

/**
 * Extract and verify the Bearer token from the Authorization header.
 * Returns { user, error } — user is null on failure.
 */
function authenticate(event) {
  const header = event.headers?.['authorization'] || event.headers?.['Authorization'] || '';
  if (!header.startsWith('Bearer ')) return { user: null, error: 'Missing token' };
  const token = header.slice(7);
  const { decoded, error } = verifyToken(token);
  if (error) return { user: null, error };
  return { user: decoded, error: null };
}

/**
 * Require a logged-in user of any role.
 * Returns the decoded user or null.
 */
function requireAuth(event) {
  const { user } = authenticate(event);
  return user;
}

/**
 * Require admin or concierge role (internal team).
 */
function requireTeam(event) {
  const user = requireAuth(event);
  if (!user) return null;
  if (!['admin', 'concierge'].includes(user.role)) return null;
  return user;
}

/**
 * Require admin role only.
 */
function requireAdmin(event) {
  const user = requireAuth(event);
  if (!user) return null;
  if (user.role !== 'admin') return null;
  return user;
}

/**
 * Legacy API key check — kept for backwards compat with internal scripts.
 */
function requireApiKey(event) {
  const key = process.env.ADMIN_API_KEY;
  const provided = event.headers?.['x-admin-api-key'] || event.headers?.['X-Admin-Api-Key'];
  return Boolean(key && provided && provided === key);
}

module.exports = { signAccess, signRefresh, verifyToken, authenticate, requireAuth, requireTeam, requireAdmin, requireApiKey };
