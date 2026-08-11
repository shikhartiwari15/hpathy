import { pool } from './db.js';

/**
 * Lightweight, idempotent migrations that run on every server start.
 * Keeps databases created by intermediate schema versions in sync
 * (e.g. pack_size columns that were briefly dropped).
 */
export async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS materia');
    await client.query('SET search_path TO materia, public');

    // Core tables (no-op if they already exist)
    await client.query(`
      CREATE TABLE IF NOT EXISTS potencies (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pack_sizes (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS medicines (
        id                SERIAL PRIMARY KEY,
        name              TEXT NOT NULL,
        abbreviation      TEXT,
        kingdom           TEXT,
        common_name       TEXT,
        material_type     TEXT NOT NULL DEFAULT 'Dilution',
        pack_size         TEXT,
        pack_size_2       TEXT,
        short_description TEXT,
        indications       TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Restore columns that an intermediate schema may have dropped
    await client.query('ALTER TABLE medicines ADD COLUMN IF NOT EXISTS pack_size TEXT');
    await client.query('ALTER TABLE medicines ADD COLUMN IF NOT EXISTS pack_size_2 TEXT');
    await client.query('ALTER TABLE medicines DROP COLUMN IF EXISTS mrp');

    await client.query(`
      CREATE TABLE IF NOT EXISTS stock (
        id            SERIAL PRIMARY KEY,
        medicine_id   INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
        potency_id    INTEGER NOT NULL REFERENCES potencies(id) ON DELETE CASCADE,
        pack_size_id  INTEGER REFERENCES pack_sizes(id) ON DELETE CASCADE,
        quantity      INTEGER NOT NULL DEFAULT 0,
        min_level     INTEGER NOT NULL DEFAULT 0,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Ensure pack_size_id column exists on older stock tables
    const col = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'materia' AND table_name = 'stock' AND column_name = 'pack_size_id'
    `);
    if (!col.rowCount) {
      await client.query(
        'ALTER TABLE stock ADD COLUMN pack_size_id INTEGER REFERENCES pack_sizes(id) ON DELETE CASCADE'
      );
    }

    // Seed pack_sizes from medicine labels
    await client.query(`
      INSERT INTO pack_sizes (name, sort_order)
      SELECT DISTINCT trim(ps), 0
      FROM (
        SELECT pack_size AS ps FROM medicines WHERE pack_size IS NOT NULL AND btrim(pack_size) <> ''
        UNION
        SELECT pack_size_2 FROM medicines WHERE pack_size_2 IS NOT NULL AND btrim(pack_size_2) <> ''
      ) t
      ON CONFLICT (name) DO NOTHING
    `);

    // Migrate legacy pack_no → pack_size_id if needed
    const hasPackNo = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'materia' AND table_name = 'stock' AND column_name = 'pack_no'
    `);
    if (hasPackNo.rowCount) {
      await client.query(`
        UPDATE stock s
        SET pack_size_id = ps.id
        FROM medicines m
        JOIN pack_sizes ps ON lower(ps.name) = lower(btrim(m.pack_size))
        WHERE s.medicine_id = m.id AND s.pack_no = 1 AND s.pack_size_id IS NULL
          AND m.pack_size IS NOT NULL AND btrim(m.pack_size) <> ''
      `);
      await client.query(`
        UPDATE stock s
        SET pack_size_id = ps.id
        FROM medicines m
        JOIN pack_sizes ps ON lower(ps.name) = lower(btrim(m.pack_size_2))
        WHERE s.medicine_id = m.id AND s.pack_no = 2 AND s.pack_size_id IS NULL
          AND m.pack_size_2 IS NOT NULL AND btrim(m.pack_size_2) <> ''
      `);
      await client.query(`
        INSERT INTO pack_sizes (name, sort_order)
        VALUES ('Default', (SELECT COALESCE(MAX(sort_order),0)+1 FROM pack_sizes))
        ON CONFLICT (name) DO NOTHING
      `);
      await client.query(`
        UPDATE stock
        SET pack_size_id = (SELECT id FROM pack_sizes ORDER BY sort_order ASC, id ASC LIMIT 1)
        WHERE pack_size_id IS NULL
      `);
      await client.query('ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_medicine_id_potency_id_key');
      await client.query('ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_medicine_id_potency_id_pack_no_key');
      await client.query('ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_pack_no_check');
      await client.query('ALTER TABLE stock DROP COLUMN IF EXISTS pack_no');
    }

    // Link any stock rows still missing pack_size_id to the medicine's pack_size label
    await client.query(`
      UPDATE stock s
      SET pack_size_id = ps.id
      FROM medicines m
      JOIN pack_sizes ps ON lower(ps.name) = lower(btrim(m.pack_size))
      WHERE s.medicine_id = m.id
        AND s.pack_size_id IS NULL
        AND m.pack_size IS NOT NULL AND btrim(m.pack_size) <> ''
    `);
    await client.query(`
      UPDATE stock s
      SET pack_size_id = ps.id
      FROM medicines m
      JOIN pack_sizes ps ON lower(ps.name) = lower(btrim(m.pack_size_2))
      WHERE s.medicine_id = m.id
        AND s.pack_size_id IS NULL
        AND m.pack_size_2 IS NOT NULL AND btrim(m.pack_size_2) <> ''
    `);
    // Last resort: first configured pack size
    await client.query(`
      UPDATE stock
      SET pack_size_id = (SELECT id FROM pack_sizes ORDER BY sort_order ASC, id ASC LIMIT 1)
      WHERE pack_size_id IS NULL
        AND EXISTS (SELECT 1 FROM pack_sizes)
    `);

    // Backfill empty medicine pack_size from stock
    await client.query(`
      UPDATE medicines m
      SET pack_size = sub.name
      FROM (
        SELECT DISTINCT ON (s.medicine_id) s.medicine_id, ps.name
        FROM stock s
        JOIN pack_sizes ps ON ps.id = s.pack_size_id
        ORDER BY s.medicine_id, s.quantity DESC NULLS LAST, ps.sort_order ASC, ps.id ASC
      ) sub
      WHERE m.id = sub.medicine_id
        AND (m.pack_size IS NULL OR btrim(m.pack_size) = '')
    `);

    await client.query(`
      UPDATE medicines m
      SET pack_size_2 = sub.name
      FROM (
        SELECT DISTINCT ON (s.medicine_id) s.medicine_id, ps.name
        FROM stock s
        JOIN pack_sizes ps ON ps.id = s.pack_size_id
        JOIN medicines med ON med.id = s.medicine_id
        WHERE med.pack_size IS NOT NULL
          AND lower(ps.name) <> lower(btrim(med.pack_size))
        ORDER BY s.medicine_id, s.quantity DESC NULLS LAST, ps.sort_order ASC, ps.id ASC
      ) sub
      WHERE m.id = sub.medicine_id
        AND (m.pack_size_2 IS NULL OR btrim(m.pack_size_2) = '')
    `);

    // Unique constraint on stock
    const uq = await client.query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'stock_medicine_id_potency_id_pack_size_id_key'
    `);
    if (!uq.rowCount) {
      await client.query(`
        DELETE FROM stock a USING stock b
        WHERE a.id > b.id
          AND a.medicine_id = b.medicine_id
          AND a.potency_id = b.potency_id
          AND a.pack_size_id IS NOT DISTINCT FROM b.pack_size_id
      `);
      await client.query(`
        ALTER TABLE stock ADD CONSTRAINT stock_medicine_id_potency_id_pack_size_id_key
          UNIQUE (medicine_id, potency_id, pack_size_id)
      `);
    }

    // Indexes
    await client.query('CREATE INDEX IF NOT EXISTS stock_medicine_idx ON stock (medicine_id)');
    await client.query('CREATE INDEX IF NOT EXISTS stock_potency_idx ON stock (potency_id)');
    await client.query('CREATE INDEX IF NOT EXISTS stock_pack_size_idx ON stock (pack_size_id)');
    await client.query('CREATE INDEX IF NOT EXISTS medicines_name_idx ON medicines (name)');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS medicines_name_lower_uk ON medicines (lower(name))
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS medicines_abbr_lower_uk
        ON medicines (lower(abbreviation))
        WHERE abbreviation IS NOT NULL AND btrim(abbreviation) <> ''
    `);


    // Normalize legacy material_type values to the three allowed types
    await client.query(`
      UPDATE medicines SET material_type = 'DILUTIONS & POTENCIES'
      WHERE material_type IS NULL
         OR btrim(material_type) = ''
         OR lower(material_type) IN ('dilution', 'dilutions', 'potency', 'potencies')
         OR lower(material_type) LIKE '%dilution%'
         OR lower(material_type) LIKE '%potenc%'
    `);
    await client.query(`
      UPDATE medicines SET material_type = 'TRITURATION TABLETS'
      WHERE lower(material_type) LIKE '%trituration%'
         OR lower(material_type) LIKE '%tablet%'
    `);
    await client.query(`
      UPDATE medicines SET material_type = 'MOTHER TINCTURES'
      WHERE lower(material_type) LIKE '%mother%'
         OR lower(material_type) LIKE '%tincture%'
    `);

    console.log('[migrate] Schema is up to date (pack_size columns ensured).');

  } finally {
    client.release();
  }
}
