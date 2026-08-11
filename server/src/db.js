import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// pg reads PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE from the
// environment automatically, so a bare Pool() picks up your .env values.
export const pool = new pg.Pool();

// Every connection resolves unqualified table names against the `materia`
// schema first, so this app stays isolated from any other tables in the same
// database. `materia` is created by schema.sql (npm run db:setup); pointing at
// a not-yet-created schema here is harmless.
pool.on('connect', (client) => {
  client.query('SET search_path TO materia, public');
});

export const query = (text, params) => pool.query(text, params);

// Small helper for running everything in a transaction.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
