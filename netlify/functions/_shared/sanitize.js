function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripNulls(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null));
}

module.exports = { escapeHtml, stripNulls };
