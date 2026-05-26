const { buildCorsHeaders } = require('./cors');

function ok(event, data, status = 200) {
  return {
    statusCode: status,
    headers: buildCorsHeaders(event),
    body: JSON.stringify(data),
  };
}

function err(event, status, message) {
  return {
    statusCode: status,
    headers: buildCorsHeaders(event),
    body: JSON.stringify({ error: message }),
  };
}

function preflight(event) {
  return {
    statusCode: 204,
    headers: buildCorsHeaders(event),
    body: '',
  };
}

module.exports = { ok, err, preflight };
