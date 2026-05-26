const MAX_BODY = 64 * 1024; // 64 KB

function parseJson(event) {
  const body = event.body || '';
  if (body.length > MAX_BODY) return { data: null, error: 'Payload too large' };
  try {
    return { data: JSON.parse(body), error: null };
  } catch {
    return { data: null, error: 'Invalid JSON' };
  }
}

function isEmail(s) {
  return typeof s === 'string' && s.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function isUuid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function clamp(val, max) {
  return String(val || '').trim().slice(0, max);
}

module.exports = { parseJson, isEmail, isUuid, clamp };
