function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function buildCorsHeaders(event) {
  const requestOrigin = event?.headers?.origin || event?.headers?.Origin || '';
  const allowed = parseAllowedOrigins();

  let origin = 'null';
  if (allowed.length === 0 || allowed.includes(requestOrigin)) {
    origin = requestOrigin || '*';
  }

  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Api-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

module.exports = { buildCorsHeaders, parseAllowedOrigins };
