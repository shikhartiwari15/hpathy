-- Homoeopathy medicine stock manager - schema
-- Safe to run repeatedly (idempotent).

CREATE SCHEMA IF NOT EXISTS materia;
SET search_path TO materia, public;

CREATE TABLE IF NOT EXISTS potencies (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pack_sizes (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
);

-- Ensure legacy columns exist (may have been dropped by an intermediate schema version)
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS pack_size TEXT;
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS pack_size_2 TEXT;
ALTER TABLE medicines DROP COLUMN IF EXISTS mrp;

CREATE UNIQUE INDEX IF NOT EXISTS medicines_name_lower_uk
  ON medicines (lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS medicines_abbr_lower_uk
  ON medicines (lower(abbreviation))
  WHERE abbreviation IS NOT NULL AND btrim(abbreviation) <> '';

CREATE INDEX IF NOT EXISTS medicines_name_idx ON medicines (name);

CREATE TABLE IF NOT EXISTS stock (
  id            SERIAL PRIMARY KEY,
  medicine_id   INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  potency_id    INTEGER NOT NULL REFERENCES potencies(id) ON DELETE CASCADE,
  pack_size_id  INTEGER REFERENCES pack_sizes(id) ON DELETE CASCADE,
  quantity      INTEGER NOT NULL DEFAULT 0,
  min_level     INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Migrate legacy pack_no → pack_size_id, seed pack_sizes from medicine labels ──
DO $$
DECLARE
  has_pack_no boolean;
  has_pack_size_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'materia' AND table_name = 'stock' AND column_name = 'pack_no'
  ) INTO has_pack_no;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'materia' AND table_name = 'stock' AND column_name = 'pack_size_id'
  ) INTO has_pack_size_id;

  IF NOT has_pack_size_id THEN
    ALTER TABLE stock ADD COLUMN pack_size_id INTEGER REFERENCES pack_sizes(id) ON DELETE CASCADE;
  END IF;

  -- Seed pack_sizes from distinct medicine pack labels
  INSERT INTO pack_sizes (name, sort_order)
  SELECT DISTINCT trim(ps), 0
  FROM (
    SELECT pack_size AS ps FROM medicines WHERE pack_size IS NOT NULL AND btrim(pack_size) <> ''
    UNION
    SELECT pack_size_2 FROM medicines WHERE pack_size_2 IS NOT NULL AND btrim(pack_size_2) <> ''
  ) t
  ON CONFLICT (name) DO NOTHING;

  WITH ordered AS (
    SELECT id, row_number() OVER (ORDER BY id) AS rn FROM pack_sizes WHERE sort_order = 0
  )
  UPDATE pack_sizes ps SET sort_order = ordered.rn FROM ordered WHERE ps.id = ordered.id;

  IF has_pack_no THEN
    UPDATE stock s
    SET pack_size_id = ps.id
    FROM medicines m
    JOIN pack_sizes ps ON lower(ps.name) = lower(btrim(m.pack_size))
    WHERE s.medicine_id = m.id
      AND s.pack_no = 1
      AND s.pack_size_id IS NULL
      AND m.pack_size IS NOT NULL AND btrim(m.pack_size) <> '';

    UPDATE stock s
    SET pack_size_id = ps.id
    FROM medicines m
    JOIN pack_sizes ps ON lower(ps.name) = lower(btrim(m.pack_size_2))
    WHERE s.medicine_id = m.id
      AND s.pack_no = 2
      AND s.pack_size_id IS NULL
      AND m.pack_size_2 IS NOT NULL AND btrim(m.pack_size_2) <> '';

    IF EXISTS (SELECT 1 FROM stock WHERE pack_size_id IS NULL) THEN
      INSERT INTO pack_sizes (name, sort_order)
      VALUES ('Default', (SELECT COALESCE(MAX(sort_order),0)+1 FROM pack_sizes))
      ON CONFLICT (name) DO NOTHING;

      UPDATE stock
      SET pack_size_id = (SELECT id FROM pack_sizes ORDER BY sort_order ASC, id ASC LIMIT 1)
      WHERE pack_size_id IS NULL;
    END IF;

    ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_medicine_id_potency_id_key;
    ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_medicine_id_potency_id_pack_no_key;
    ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_pack_no_check;
    ALTER TABLE stock DROP COLUMN IF EXISTS pack_no;
  END IF;

  -- Backfill medicines.pack_size from stock when the text column is empty
  -- (e.g. after an intermediate schema version dropped the column)
  UPDATE medicines m
  SET pack_size = sub.name
  FROM (
    SELECT DISTINCT ON (s.medicine_id) s.medicine_id, ps.name
    FROM stock s
    JOIN pack_sizes ps ON ps.id = s.pack_size_id
    ORDER BY s.medicine_id, s.quantity DESC NULLS LAST, ps.sort_order ASC, ps.id ASC
  ) sub
  WHERE m.id = sub.medicine_id
    AND (m.pack_size IS NULL OR btrim(m.pack_size) = '');

  -- Secondary pack: a different pack size used by the same medicine
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
    AND (m.pack_size_2 IS NULL OR btrim(m.pack_size_2) = '');

  IF NOT EXISTS (SELECT 1 FROM stock WHERE pack_size_id IS NULL)
     AND EXISTS (SELECT 1 FROM pack_sizes) THEN
    BEGIN
      ALTER TABLE stock ALTER COLUMN pack_size_id SET NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_medicine_id_potency_id_pack_size_id_key'
  ) THEN
    DELETE FROM stock a USING stock b
    WHERE a.id > b.id
      AND a.medicine_id = b.medicine_id
      AND a.potency_id = b.potency_id
      AND a.pack_size_id IS NOT DISTINCT FROM b.pack_size_id;

    ALTER TABLE stock ADD CONSTRAINT stock_medicine_id_potency_id_pack_size_id_key
      UNIQUE (medicine_id, potency_id, pack_size_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS stock_medicine_idx ON stock (medicine_id);
CREATE INDEX IF NOT EXISTS stock_potency_idx  ON stock (potency_id);
CREATE INDEX IF NOT EXISTS stock_pack_size_idx ON stock (pack_size_id);
