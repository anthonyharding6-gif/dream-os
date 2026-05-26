const { neon } = require('@neondatabase/serverless');

let sql = null;

function getDb() {
  if (!sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

module.exports = { getDb, isDbConfigured };
