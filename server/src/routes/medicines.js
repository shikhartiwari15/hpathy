import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { pool, withTransaction } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Friendly message for a unique-constraint violation (name vs abbreviation).
function dupMessage(err) {
  if (err.code !== '23505') return null;
  if (err.constraint && err.constraint.includes('abbr'))
    return 'A medicine with this abbreviation already exists';
  return 'A medicine with this name already exists';
}

// Columns in the bulk-upload sheet that are NOT potencies.
// Pack Size / Pack Size 2 are accepted for backward compatibility: they seed
// the global pack_sizes table (if missing) and the quantity columns still land
// on the first pack size.
const META_HEADERS = {
  'latin name (remedy)': 'name',
  'remedy': 'name',
  'name': 'name',
  'abbreviation': 'abbreviation',
  'kingdom': 'kingdom',
  'common name': 'common_name',
  'common name / description': 'common_name',
  'common name/description': 'common_name',
  'common name / desc': 'common_name',
  'material type': 'material_type',
  'type': 'material_type',
  'pack size': 'pack_size',       // legacy — seeds pack_sizes only
  'pack size 2': 'pack_size_2',   // legacy — seeds pack_sizes only
  'pack size (2)': 'pack_size_2',
  'second pack size': 'pack_size_2',
  'short description': 'short_description',
  'indication/benefits': 'indications',
  'indication / benefits': 'indications',
  'indications': 'indications',
};

// GET /api/medicines?search=&letter=
// Returns a lightweight list plus total-quantity and any low-stock flag.
router.get('/', async (req, res, next) => {
  try {
    const { search, letter } = req.query;
    const params = [];
    const where = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(m.name ILIKE $${params.length} OR m.abbreviation ILIKE $${params.length})`);
    }
    if (letter) {
      params.push(`${letter}%`);
      where.push(`m.name ILIKE $${params.length}`);
    }

    const sql = `
      SELECT m.id, m.name, m.abbreviation, m.material_type, m.pack_size, m.pack_size_2,
             m.short_description,
             COALESCE(SUM(s.quantity), 0)::int AS total_qty,
             COALESCE(bool_or(s.quantity < s.min_level AND s.min_level > 0), false) AS low_stock
      FROM medicines m
      LEFT JOIN stock s ON s.medicine_id = m.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY m.id
      ORDER BY m.name ASC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/medicines/letters  -> which A-Z letters have medicines
router.get('/letters', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT upper(left(name, 1)) AS letter FROM medicines ORDER BY letter`
    );
    res.json(rows.map(r => r.letter));
  } catch (err) { next(err); }
});

// GET /api/medicines/:id  -> full detail + per-potency × pack-size stock
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM medicines WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Medicine not found' });
    const medicine = rows[0];

    const packSizes = (await pool.query(
      'SELECT id, name, sort_order FROM pack_sizes ORDER BY sort_order ASC, id ASC'
    )).rows;

    const stock = await pool.query(
      `SELECT p.id AS potency_id, p.name AS potency, p.sort_order,
              ps.id AS pack_size_id, ps.name AS pack_size, ps.sort_order AS pack_sort,
              COALESCE(s.quantity, 0) AS quantity,
              COALESCE(s.min_level, 0) AS min_level
       FROM potencies p
       CROSS JOIN pack_sizes ps
       LEFT JOIN stock s ON s.potency_id = p.id AND s.medicine_id = $1 AND s.pack_size_id = ps.id
       ORDER BY p.sort_order ASC, p.id ASC, ps.sort_order ASC, ps.id ASC`,
      [req.params.id]
    );

    medicine.pack_sizes = packSizes;
    medicine.stock = stock.rows;
    res.json(medicine);
  } catch (err) { next(err); }
});

// POST /api/medicines  -> create one
router.post('/', async (req, res, next) => {
  try {
    const m = req.body;
    const { rows } = await pool.query(
      `INSERT INTO medicines
         (name, abbreviation, kingdom, common_name, material_type, pack_size, pack_size_2, short_description, indications)
       VALUES ($1,$2,$3,$4,COALESCE($5,'DILUTIONS & POTENCIES'),$6,$7,$8,$9)
       RETURNING *`,
      [m.name, m.abbreviation, m.kingdom, m.common_name, m.material_type,
       m.pack_size, m.pack_size_2, m.short_description, m.indications]
    );
    // Ensure pack size names exist in the global catalogue
    for (const label of [m.pack_size, m.pack_size_2]) {
      if (label && String(label).trim()) {
        await pool.query(
          `INSERT INTO pack_sizes (name, sort_order)
           VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM pack_sizes))
           ON CONFLICT (name) DO NOTHING`,
          [String(label).trim()]
        );
      }
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    const dup = dupMessage(err);
    if (dup) return res.status(409).json({ error: dup });
    next(err);
  }
});

// PUT /api/medicines/:id  -> update one
router.put('/:id', async (req, res, next) => {
  try {
    const m = req.body;
    const { rows } = await pool.query(
      `UPDATE medicines SET
         name=$1, abbreviation=$2, kingdom=$3, common_name=$4, material_type=$5,
         pack_size=$6, pack_size_2=$7, short_description=$8, indications=$9, updated_at=now()
       WHERE id=$10 RETURNING *`,
      [m.name, m.abbreviation, m.kingdom, m.common_name, m.material_type,
       m.pack_size, m.pack_size_2, m.short_description, m.indications, req.params.id]
    );
    for (const label of [m.pack_size, m.pack_size_2]) {
      if (label && String(label).trim()) {
        await pool.query(
          `INSERT INTO pack_sizes (name, sort_order)
           VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM pack_sizes))
           ON CONFLICT (name) DO NOTHING`,
          [String(label).trim()]
        );
      }
    }
    if (!rows.length) return res.status(404).json({ error: 'Medicine not found' });
    res.json(rows[0]);
  } catch (err) {
    const dup = dupMessage(err);
    if (dup) return res.status(409).json({ error: dup });
    next(err);
  }
});

// POST /api/medicines/bulk-delete  -> delete a set of ids  { ids: [1,2,3] }
router.post('/bulk-delete', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ error: 'No medicine ids provided' });
    const { rowCount } = await pool.query('DELETE FROM medicines WHERE id = ANY($1::int[])', [ids]);
    res.json({ ok: true, deleted: rowCount });
  } catch (err) { next(err); }
});

// DELETE /api/medicines  -> delete ALL medicines (and their stock, via cascade).
// Requires ?confirm=DELETE-ALL to guard against accidental calls.
router.delete('/', async (req, res, next) => {
  try {
    if (req.query.confirm !== 'DELETE-ALL')
      return res.status(400).json({ error: 'Confirmation required' });
    const { rowCount } = await pool.query('DELETE FROM medicines');
    res.json({ ok: true, deleted: rowCount });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM medicines WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Medicine not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Parse an uploaded .xlsx buffer into the same row shape used by bulkUpsert.
function parseUploadRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });

  return raw.map((r) => {
    const out = { potencies: {} };
    for (const [key, val] of Object.entries(r)) {
      const norm = String(key).trim().toLowerCase();
      if (norm === 's.no.' || norm === 's.no' || norm === 'sno') continue;
      if (META_HEADERS[norm]) {
        out[META_HEADERS[norm]] = val;
      } else if (val !== null && val !== '') {
        out.potencies[String(key).trim()] = val;
      }
    }
    return out;
  }).filter((r) => r.name);
}

// Look at the parsed rows and find every abbreviation that would be ambiguous:
// either two different remedies in the sheet share it, or the sheet's remedy
// clashes with a *different* remedy that already owns it in the database.
// Returns [] when nothing needs a human decision.
async function detectAbbrConflicts(rows) {
  const groups = new Map(); // abbrLower -> { raw, names: Map(nameLower -> {name, rows}) }
  for (const row of rows) {
    const abbr = row.abbreviation != null ? String(row.abbreviation).trim() : '';
    if (!abbr) continue;
    const key = abbr.toLowerCase();
    if (!groups.has(key)) groups.set(key, { raw: abbr, names: new Map() });
    const g = groups.get(key);
    const nameKey = String(row.name).trim().toLowerCase();
    if (!g.names.has(nameKey)) g.names.set(nameKey, { name: String(row.name).trim(), rows: 0 });
    g.names.get(nameKey).rows++;
  }
  if (!groups.size) return [];

  const { rows: existingRows } = await pool.query(
    `SELECT id, name, abbreviation FROM medicines WHERE lower(abbreviation) = ANY($1::text[])`,
    [[...groups.keys()]]
  );
  const existingMap = new Map(existingRows.map((r) => [r.abbreviation.toLowerCase(), r]));

  const conflicts = [];
  for (const [key, g] of groups) {
    const inFile = [...g.names.values()];
    const existing = existingMap.get(key);
    const fileHasSplit = inFile.length > 1;
    const clashesWithExisting = existing && !inFile.some((n) => n.name.toLowerCase() === existing.name.toLowerCase());
    if (!fileHasSplit && !clashesWithExisting) continue;

    const candidates = inFile.map((n) => ({ type: 'incoming', name: n.name, rows: n.rows }));
    if (existing) candidates.push({ type: 'existing', id: existing.id, name: existing.name });
    conflicts.push({ abbreviation: g.raw, candidates });
  }
  return conflicts;
}

// Apply the user's chosen winner for each contested abbreviation before the
// upsert runs: the loser(s) go in without an abbreviation, and if an existing
// DB row currently holds it, that gets cleared so the winner can take it.
async function applyAbbrResolutions(client, rows, resolutions) {
  for (const [abbrKey, resolution] of Object.entries(resolutions || {})) {
    const winnerName = resolution?.type === 'incoming' ? String(resolution.name || '').trim().toLowerCase() : null;

    if (resolution?.type === 'incoming') {
      await client.query(
        `UPDATE medicines SET abbreviation = NULL
         WHERE lower(abbreviation) = $1 AND lower(name) <> $2`,
        [abbrKey, winnerName]
      );
    } else if (resolution?.type === 'existing' || resolution?.type === 'none') {
      if (resolution.type === 'none') {
        await client.query(`UPDATE medicines SET abbreviation = NULL WHERE lower(abbreviation) = $1`, [abbrKey]);
      }
    }

    for (const row of rows) {
      const abbr = row.abbreviation != null ? String(row.abbreviation).trim() : '';
      if (!abbr || abbr.toLowerCase() !== abbrKey) continue;
      const keepsIt = winnerName && String(row.name).trim().toLowerCase() === winnerName;
      if (!keepsIt) row.abbreviation = null;
    }
  }
}

// Ensure a pack size exists by name; returns its id. Used by bulk upload.
async function ensurePackSize(client, name, packSizeMap, maxOrderRef) {
  const key = name.toLowerCase();
  if (packSizeMap.has(key)) return packSizeMap.get(key);
  maxOrderRef.v += 1;
  const np = await client.query(
    'INSERT INTO pack_sizes (name, sort_order) VALUES ($1,$2) RETURNING id',
    [name, maxOrderRef.v]
  );
  const id = np.rows[0].id;
  packSizeMap.set(key, id);
  return id;
}

// Shared upsert used by bulk JSON and Excel upload. Runs inside a transaction.
// `rows` is an array of { meta fields..., potencies: { "30C": 5, ... } }
async function bulkUpsert(client, rows) {
  // Cache existing potencies (name -> id), auto-create any new ones.
  const pRes = await client.query('SELECT id, name, sort_order FROM potencies');
  const potencyMap = new Map(pRes.rows.map(p => [p.name.toLowerCase(), p.id]));
  let maxOrder = pRes.rows.reduce((mx, p) => Math.max(mx, p.sort_order), 0);

  // Cache pack sizes; bulk upload quantities always land on the first pack size
  // (by sort order). Legacy "Pack Size" / "Pack Size 2" columns seed the table.
  const psRes = await client.query('SELECT id, name, sort_order FROM pack_sizes ORDER BY sort_order ASC, id ASC');
  const packSizeMap = new Map(psRes.rows.map(p => [p.name.toLowerCase(), p.id]));
  const maxPsOrder = { v: psRes.rows.reduce((mx, p) => Math.max(mx, p.sort_order), 0) };

  // Seed any pack sizes mentioned in the sheet
  for (const row of rows) {
    for (const field of ['pack_size', 'pack_size_2']) {
      const raw = row[field];
      if (raw == null || String(raw).trim() === '') continue;
      await ensurePackSize(client, String(raw).trim(), packSizeMap, maxPsOrder);
    }
  }

  // Default pack size for stock quantities: first by sort order, or create "30 ML"
  let defaultPackSizeId = psRes.rows[0]?.id
    || [...packSizeMap.values()][0]
    || null;
  if (!defaultPackSizeId) {
    defaultPackSizeId = await ensurePackSize(client, '30 ML', packSizeMap, maxPsOrder);
  }

  let created = 0, updated = 0, stockRows = 0, abbrConflicts = 0;

  const upsertSql = `
      INSERT INTO medicines
        (name, abbreviation, kingdom, common_name, material_type, pack_size, pack_size_2, short_description, indications)
      VALUES ($1,$2,$3,$4,COALESCE($5,'DILUTIONS & POTENCIES'),$6,$7,$8,$9)
      ON CONFLICT (lower(name)) DO UPDATE SET
        abbreviation      = COALESCE(EXCLUDED.abbreviation, medicines.abbreviation),
        kingdom           = COALESCE(EXCLUDED.kingdom, medicines.kingdom),
        common_name       = COALESCE(EXCLUDED.common_name, medicines.common_name),
        material_type     = COALESCE(EXCLUDED.material_type, medicines.material_type),
        pack_size         = COALESCE(EXCLUDED.pack_size, medicines.pack_size),
        pack_size_2       = COALESCE(EXCLUDED.pack_size_2, medicines.pack_size_2),
        short_description = COALESCE(EXCLUDED.short_description, medicines.short_description),
        indications       = COALESCE(EXCLUDED.indications, medicines.indications),
        updated_at        = now()
      RETURNING id, (xmax = 0) AS inserted`;

  for (const row of rows) {
    if (!row.name || !String(row.name).trim()) continue;

    const vals = (abbr) => [String(row.name).trim(), abbr, row.kingdom || null,
      row.common_name || null, row.material_type || null, row.pack_size || null,
      row.pack_size_2 || null, row.short_description || null, row.indications || null];

    let up;
    await client.query('SAVEPOINT sp_med');
    try {
      up = await client.query(upsertSql, vals(row.abbreviation || null));
      await client.query('RELEASE SAVEPOINT sp_med');
    } catch (e) {
      // A duplicate abbreviation (belonging to a different remedy) would abort the
      // whole import — instead roll back this row and re-import it without the
      // clashing abbreviation, so the remedy still loads. Count it for the report.
      if (e.code === '23505' && e.constraint && e.constraint.includes('abbr')) {
        await client.query('ROLLBACK TO SAVEPOINT sp_med');
        up = await client.query(upsertSql, vals(null));
        await client.query('RELEASE SAVEPOINT sp_med');
        abbrConflicts++;
      } else {
        await client.query('ROLLBACK TO SAVEPOINT sp_med');
        throw e;
      }
    }

    const medicineId = up.rows[0].id;
    up.rows[0].inserted ? created++ : updated++;

    // Prefer the row's own Pack Size column if present, else the global default
    let rowPackId = defaultPackSizeId;
    if (row.pack_size != null && String(row.pack_size).trim() !== '') {
      rowPackId = await ensurePackSize(client, String(row.pack_size).trim(), packSizeMap, maxPsOrder);
    }

    for (const [pname, rawQty] of Object.entries(row.potencies || {})) {
      const qty = Number(rawQty);
      if (!Number.isFinite(qty)) continue;
      let pid = potencyMap.get(pname.toLowerCase());
      if (!pid) {
        maxOrder += 1;
        const np = await client.query(
          'INSERT INTO potencies (name, sort_order) VALUES ($1,$2) RETURNING id',
          [pname, maxOrder]
        );
        pid = np.rows[0].id;
        potencyMap.set(pname.toLowerCase(), pid);
      }
      // Bulk-upload sheets carry one quantity per potency → assigned to this
      // row's pack size (or the first configured pack size).
      await client.query(
        `INSERT INTO stock (medicine_id, potency_id, pack_size_id, quantity)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (medicine_id, potency_id, pack_size_id)
         DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
        [medicineId, pid, rowPackId, qty]
      );
      stockRows++;
    }
  }
  return { created, updated, stockRows, abbrConflicts };
}

// POST /api/medicines/bulk  -> JSON array of rows (from the management page)
router.post('/bulk', async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body) ? req.body : req.body.rows;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'Expected an array of rows' });
    const result = await withTransaction(c => bulkUpsert(c, rows));
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/medicines/template/download  -> an .xlsx with the correct headers
router.get('/template/download', async (_req, res, next) => {
  try {
    const { rows: potencies } = await pool.query(
      'SELECT name FROM potencies ORDER BY sort_order ASC, id ASC'
    );
    const header = [
      'S.No.', 'Latin Name (Remedy)', 'Common Name', 'Abbreviation', 'Kingdom',
      'Material Type', 'Pack Size', 'Pack Size 2', 'Short Description', 'Indication/Benefits',
      ...potencies.map(p => p.name),
    ];
    const example = [
      1, 'Elaterium', 'Squirting Cucumber', 'Elat.', 'Plant', 'DILUTIONS & POTENCIES', '30 ML', '100 ML',
      'Helps in Colic, Cramps, Diarrhoea, Dysentery, Fever, Jaundice, Urticaria',
      'Powerful purgative remedy suited to profuse watery diarrhoea and jaundice.',
    ];
    while (example.length < header.length) example.push('');

    const ws = XLSX.utils.aoa_to_sheet([header, example]);
    ws['!cols'] = header.map(h => ({ wch: Math.max(10, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Medicines');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="medicine_upload_template.xlsx"');
    res.send(buf);
  } catch (err) { next(err); }
});

// POST /api/medicines/upload  -> multipart .xlsx file
//
// Two-step flow when the sheet has ambiguous abbreviations:
//   1. Called with just `file` -> if any abbreviation is shared by two remedies
//      in the sheet, or clashes with a *different* remedy already in the
//      database, nothing is written. Instead we respond 409 with the list of
//      conflicts so the UI can ask the person which remedy should keep it.
//   2. Called again with the same `file` plus a `resolutions` field (JSON:
//      { [abbreviation]: { type: 'incoming', name } | { type: 'existing', id } | { type: 'none' } })
//      -> those choices are applied and the import is committed.
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const rows = parseUploadRows(req.file.buffer);

    let resolutions = null;
    if (req.body?.resolutions) {
      try { resolutions = JSON.parse(req.body.resolutions); }
      catch { return res.status(400).json({ error: 'Invalid resolutions payload' }); }
    }

    if (!resolutions) {
      const conflicts = await detectAbbrConflicts(rows);
      if (conflicts.length) {
        return res.status(409).json({ needsResolution: true, conflicts, parsedRows: rows.length });
      }
    }

    const result = await withTransaction(async (c) => {
      if (resolutions) await applyAbbrResolutions(c, rows, resolutions);
      return bulkUpsert(c, rows);
    });
    res.json({ ...result, parsedRows: rows.length });
  } catch (err) { next(err); }
});

export default router;
