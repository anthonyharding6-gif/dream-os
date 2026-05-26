#!/usr/bin/env node
/**
 * Apply schema.sql to the Neon database.
 * Usage: DATABASE_URL=... node scripts/db-migrate.js
 */
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, '..', 'lib', 'db', 'schema.sql');
  const sql_text = fs.readFileSync(schemaPath, 'utf8');

  const sql = neon(url);
  console.log('Applying schema...');
  await sql(sql_text);
  console.log('Schema applied.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
