'use strict';

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL non impostato. Configura la connessione Postgres (es. postgresql://user:pass@host:5432/db).'
    );
  }
  const ssl =
    process.env.DATABASE_SSL === 'true' ||
    /sslmode=require/i.test(connectionString)
      ? { rejectUnauthorized: false }
      : false;
  pool = new Pool({ connectionString, ssl, max: 10 });
  pool.on('error', (err) => {
    console.error('[db] errore pool Postgres:', err.message);
  });
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function migrate() {
  const sql = `
    CREATE TABLE IF NOT EXISTS invoices (
      id           TEXT PRIMARY KEY,
      numero       TEXT,
      data         DATE,
      cliente      TEXT,
      cliente_email TEXT,
      totale       NUMERIC(14,2),
      origine      TEXT,
      payload      JSONB NOT NULL,
      email_sent_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS invoices_data_idx ON invoices(data DESC);
    CREATE INDEX IF NOT EXISTS invoices_numero_idx ON invoices(numero);

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await query(sql);
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, migrate, close };
