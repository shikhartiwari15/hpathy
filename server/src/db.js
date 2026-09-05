import dotenv from 'dotenv';

dotenv.config();

// Choose the Postgres driver at runtime so the SAME codebase can deploy to
// both a normal Node host and an edge/serverless host that can't hold a raw
// TCP socket to Postgres:
//
//   DB_DRIVER=pg    -> node-postgres over TCP    (default; Render + local dev)
//   DB_DRIVER=neon  -> @neondatabase/serverless over WebSocket (Wasmer Edge)
//
// Connection details come from DATABASE_URL when it is set; otherwise `pg`
// falls back to the individual PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
// variables, which keeps local development working exactly as before.
const driver = (process.env.DB_DRIVER || 'pg').toLowerCase();
const connectionString = process.env.DATABASE_URL;

let Pool;
if (driver === 'neon') {
  // Neon's serverless driver speaks the Postgres protocol over a secure
  // WebSocket instead of raw TCP, which is what makes it viable on edge
  // runtimes. Its Pool is API-compatible with node-postgres.
  const neon = await import('@neondatabase/serverless');
  Pool = neon.Pool;
  // Node (and the QuickJS-based edge runtime) has no global WebSocket, so we
  // hand the driver one. `ws` falls back to a pure-JS implementation when the
  // optional native `bufferutil` addon is absent -- which is what we want on a
  // WebAssembly runtime where native addons can't load.
  const ws = (await import('ws')).default;
  neon.neonConfig.webSocketConstructor = ws;
} else {
  const pg = (await import('pg')).default;
  Pool = pg.Pool;
}

// A bare `new Pool()` still reads the PG* env vars; passing connectionString
// wins whenever DATABASE_URL is set. Managed Postgres (Neon, Render external)
// requires TLS; localhost does not, so only enable ssl when we have a URL.
export const pool = new Pool(
  connectionString
    ? { connectionString, ssl: { rejectUnauthorized: false } }
    : {}
);

// Every connection resolves unqualified table names against the `materia`
// schema first, so this app stays isolated from any other tables in the same
// database. `materia` is created by ensureSchema()/schema.sql; pointing at a
// not-yet-created schema here is harmless.
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
