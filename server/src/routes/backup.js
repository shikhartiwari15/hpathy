import { Router } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { pool, withTransaction } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function cell(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
    // case-insensitive key match
    const found = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k.toLowerCase());
    if (found != null && row[found] != null && String(row[found]).trim() !== '') {
      return String(row[found]).trim();
    }
  }
  return null;
}

function num(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function sheetRows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

// GET /api/backup/excel
router.get('/excel', async (_req, res, next) => {
  try {
    const [{ rows: potencies }, { rows: packSizes }, { rows: meds }, { rows: stock }] = await Promise.all([
      pool.query('SELECT id, name, sort_order FROM potencies ORDER BY sort_order ASC, id ASC'),
      pool.query('SELECT id, name, sort_order FROM pack_sizes ORDER BY sort_order ASC, id ASC'),
      pool.query(`SELECT id, name, abbreviation, kingdom, common_name, material_type,
                         pack_size, pack_size_2, short_description, indications
                  FROM medicines ORDER BY name ASC`),
      pool.query(`SELECT s.medicine_id, m.name AS medicine, p.name AS potency, p.sort_order AS potency_sort,
                         ps.name AS pack_label, s.pack_size_id, s.quantity, s.min_level,
                         m.pack_size AS med_pack_size, m.pack_size_2 AS med_pack_size_2
                  FROM stock s
                  JOIN medicines m ON m.id = s.medicine_id
                  JOIN potencies p ON p.id = s.potency_id
                  LEFT JOIN pack_sizes ps ON ps.id = s.pack_size_id
                  ORDER BY m.name, p.sort_order, ps.sort_order NULLS LAST, s.id`),
    ]);

    const primaryQty = new Map();
    const anyQty = new Map();
    for (const s of stock) {
      const qty = Number(s.quantity);
      if (!Number.isFinite(qty)) continue;
      if (!anyQty.has(s.medicine_id)) anyQty.set(s.medicine_id, {});
      const prev = anyQty.get(s.medicine_id)[s.potency];
      if (prev == null || qty > prev) anyQty.get(s.medicine_id)[s.potency] = qty;
      const primary = (s.med_pack_size || '').trim().toLowerCase();
      const label = (s.pack_label || '').trim().toLowerCase();
      const isPrimary = !primary || !label || label === primary;
      if (isPrimary) {
        if (!primaryQty.has(s.medicine_id)) primaryQty.set(s.medicine_id, {});
        primaryQty.get(s.medicine_id)[s.potency] = qty;
      }
    }

    const header = [
      'S.No.', 'Latin Name (Remedy)', 'Common Name', 'Abbreviation', 'Kingdom',
      'Material Type', 'Pack Size', 'Pack Size 2', 'Short Description', 'Indication/Benefits',
      ...potencies.map(p => p.name),
    ];
    const medRows = meds.map((m, i) => {
      const qPrimary = primaryQty.get(m.id) || {};
      const qAny = anyQty.get(m.id) || {};
      return [
        i + 1, m.name, m.common_name || '', m.abbreviation || '', m.kingdom || '',
        m.material_type || '', m.pack_size || '', m.pack_size_2 || '',
        m.short_description || '', m.indications || '',
        ...potencies.map(p => {
          const v = qPrimary[p.name] != null ? qPrimary[p.name] : qAny[p.name];
          return v != null ? v : '';
        }),
      ];
    });

    const stockHeader = ['Medicine', 'Potency', 'Pack', 'Quantity', 'Min Level'];
    const stockRows = stock.map(s => [
      s.medicine, s.potency,
      s.pack_label || s.med_pack_size || s.med_pack_size_2 || '',
      s.quantity, s.min_level,
    ]);

    const potHeader = ['Potency', 'Sort Order'];
    const potRows = potencies.map((p) => [p.name, p.sort_order]);
    const packHeader = ['Pack Size', 'Sort Order'];
    const packRows = packSizes.map((p) => [p.name, p.sort_order]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...medRows]), 'Medicines');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([stockHeader, ...stockRows]), 'Stock');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([potHeader, ...potRows]), 'Potencies');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([packHeader, ...packRows]), 'Pack Sizes');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="hpathy_backup_${stamp}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

/**
 * POST /api/backup/restore
 * Full automated restore from an Excel backup produced by GET /api/backup/excel.
 *
 * Order: Pack Sizes → Potencies → Medicines → Stock
 * Everything runs in one transaction. Existing rows are upserted by name
 * (medicines by lower(name); potencies/pack sizes by unique name).
 * Stock rows are upserted by (medicine, potency, pack).
 *
 * Optional body field: replace=true → clears stock first, then restores
 * (medicines/potencies/pack sizes are still upserted, not deleted).
 */
router.post('/restore', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No backup file uploaded' });

    let wb;
    try {
      wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch {
      return res.status(400).json({ error: 'Could not read Excel file' });
    }

    const sheetNames = wb.SheetNames.map((n) => n.toLowerCase());
    const hasMedicines = sheetNames.includes('medicines');
    const hasStock = sheetNames.includes('stock');
    if (!hasMedicines && !hasStock) {
      return res.status(400).json({
        error: 'Not a full backup file. Expected sheets named Medicines and/or Stock '
          + '(download Backup → Excel backup, then restore that file).',
      });
    }

    // Resolve sheet by case-insensitive name
    const findSheet = (wanted) =>
      wb.SheetNames.find((n) => n.toLowerCase() === wanted.toLowerCase());

    const packRows = findSheet('Pack Sizes') ? sheetRows(wb, findSheet('Pack Sizes')) : [];
    const potRows = findSheet('Potencies') ? sheetRows(wb, findSheet('Potencies')) : [];
    const medSheetName = findSheet('Medicines');
    const medRaw = medSheetName ? sheetRows(wb, medSheetName) : [];
    const stockRaw = findSheet('Stock') ? sheetRows(wb, findSheet('Stock')) : [];

    const replace = String(req.body?.replace || '').toLowerCase() === 'true'
      || req.query.replace === 'true';

    const result = await withTransaction(async (c) => {
      const stats = {
        packSizes: 0,
        potencies: 0,
        medicinesCreated: 0,
        medicinesUpdated: 0,
        stockRows: 0,
        replacedStock: false,
      };

      // 1) Pack sizes
      for (let i = 0; i < packRows.length; i++) {
        const r = packRows[i];
        const name = cell(r, 'Pack Size', 'Name', 'pack size', 'pack_size');
        if (!name) continue;
        const order = num(cell(r, 'Sort Order', 'sort_order', 'Order'), i + 1);
        await c.query(
          `INSERT INTO pack_sizes (name, sort_order) VALUES ($1,$2)
           ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
          [name, order]
        );
        stats.packSizes++;
      }

      // 2) Potencies
      for (let i = 0; i < potRows.length; i++) {
        const r = potRows[i];
        const name = cell(r, 'Potency', 'Name', 'potency');
        if (!name) continue;
        const order = num(cell(r, 'Sort Order', 'sort_order', 'Order'), i + 1);
        await c.query(
          `INSERT INTO potencies (name, sort_order) VALUES ($1,$2)
           ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
          [name, order]
        );
        stats.potencies++;
      }

      // 3) Medicines (meta only — stock comes from Stock sheet when present)
      const META = {
        'latin name (remedy)': 'name',
        'remedy': 'name',
        'name': 'name',
        'latin name': 'name',
        'abbreviation': 'abbreviation',
        'kingdom': 'kingdom',
        'common name': 'common_name',
        'material type': 'material_type',
        'type': 'material_type',
        'pack size': 'pack_size',
        'pack size 2': 'pack_size_2',
        'short description': 'short_description',
        'indication/benefits': 'indications',
        'indication / benefits': 'indications',
        'indications': 'indications',
      };

      for (const raw of medRaw) {
        const out = { potencies: {} };
        for (const [key, val] of Object.entries(raw)) {
          const norm = String(key).trim().toLowerCase();
          if (norm === 's.no.' || norm === 's.no' || norm === 'sno' || norm === 's.no') continue;
          if (META[norm]) out[META[norm]] = val;
          else if (val !== null && val !== '') out.potencies[String(key).trim()] = val;
        }
        if (!out.name || !String(out.name).trim()) continue;

        // Ensure pack size labels exist in catalogue
        for (const label of [out.pack_size, out.pack_size_2]) {
          if (label != null && String(label).trim()) {
            await c.query(
              `INSERT INTO pack_sizes (name, sort_order)
               VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM pack_sizes))
               ON CONFLICT (name) DO NOTHING`,
              [String(label).trim()]
            );
          }
        }

        const abbr = out.abbreviation != null ? String(out.abbreviation).trim() : null;
        let up;
        await c.query('SAVEPOINT sp_med');
        try {
          up = await c.query(
            `INSERT INTO medicines
               (name, abbreviation, kingdom, common_name, material_type, pack_size, pack_size_2, short_description, indications)
             VALUES ($1,$2,$3,$4,COALESCE($5,'Dilution'),$6,$7,$8,$9)
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
             RETURNING id, (xmax = 0) AS inserted`,
            [
              String(out.name).trim(), abbr || null,
              out.kingdom || null, out.common_name || null, out.material_type || null,
              out.pack_size ? String(out.pack_size).trim() : null,
              out.pack_size_2 ? String(out.pack_size_2).trim() : null,
              out.short_description || null, out.indications || null,
            ]
          );
          await c.query('RELEASE SAVEPOINT sp_med');
        } catch (e) {
          // Drop conflicting abbreviation and retry
          if (e.code === '23505') {
            await c.query('ROLLBACK TO SAVEPOINT sp_med');
            up = await c.query(
              `INSERT INTO medicines
                 (name, abbreviation, kingdom, common_name, material_type, pack_size, pack_size_2, short_description, indications)
               VALUES ($1,NULL,$2,$3,COALESCE($4,'Dilution'),$5,$6,$7,$8)
               ON CONFLICT (lower(name)) DO UPDATE SET
                 kingdom           = COALESCE(EXCLUDED.kingdom, medicines.kingdom),
                 common_name       = COALESCE(EXCLUDED.common_name, medicines.common_name),
                 material_type     = COALESCE(EXCLUDED.material_type, medicines.material_type),
                 pack_size         = COALESCE(EXCLUDED.pack_size, medicines.pack_size),
                 pack_size_2       = COALESCE(EXCLUDED.pack_size_2, medicines.pack_size_2),
                 short_description = COALESCE(EXCLUDED.short_description, medicines.short_description),
                 indications       = COALESCE(EXCLUDED.indications, medicines.indications),
                 updated_at        = now()
               RETURNING id, (xmax = 0) AS inserted`,
              [
                String(out.name).trim(),
                out.kingdom || null, out.common_name || null, out.material_type || null,
                out.pack_size ? String(out.pack_size).trim() : null,
                out.pack_size_2 ? String(out.pack_size_2).trim() : null,
                out.short_description || null, out.indications || null,
              ]
            );
            await c.query('RELEASE SAVEPOINT sp_med');
          } else {
            await c.query('ROLLBACK TO SAVEPOINT sp_med');
            throw e;
          }
        }

        if (up.rows[0].inserted) stats.medicinesCreated++;
        else stats.medicinesUpdated++;

        // If there is no Stock sheet, import potency columns from Medicines sheet
        // onto the medicine's primary pack size.
        if (!hasStock && out.potencies && Object.keys(out.potencies).length) {
          let packId = null;
          if (out.pack_size && String(out.pack_size).trim()) {
            const pr = await c.query(
              `INSERT INTO pack_sizes (name, sort_order)
               VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM pack_sizes))
               ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
               RETURNING id`,
              [String(out.pack_size).trim()]
            );
            packId = pr.rows[0].id;
          } else {
            const pr = await c.query(
              'SELECT id FROM pack_sizes ORDER BY sort_order ASC, id ASC LIMIT 1'
            );
            packId = pr.rows[0]?.id;
            if (!packId) {
              const created = await c.query(
                `INSERT INTO pack_sizes (name, sort_order) VALUES ('30 ML', 1) RETURNING id`
              );
              packId = created.rows[0].id;
            }
          }

          for (const [pname, rawQty] of Object.entries(out.potencies)) {
            const qty = Number(rawQty);
            if (!Number.isFinite(qty)) continue;
            let pot = await c.query('SELECT id FROM potencies WHERE lower(name) = lower($1)', [pname]);
            let potId = pot.rows[0]?.id;
            if (!potId) {
              const ins = await c.query(
                `INSERT INTO potencies (name, sort_order)
                 VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM potencies))
                 RETURNING id`,
                [pname]
              );
              potId = ins.rows[0].id;
            }
            await c.query(
              `INSERT INTO stock (medicine_id, potency_id, pack_size_id, quantity)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (medicine_id, potency_id, pack_size_id)
               DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
              [up.rows[0].id, potId, packId, qty]
            );
            stats.stockRows++;
          }
        }
      }

      // 4) Stock sheet — full multi-pack restore
      if (hasStock) {
        if (replace) {
          await c.query('DELETE FROM stock');
          stats.replacedStock = true;
        }

        // Maps for lookups
        const medMap = new Map(
          (await c.query('SELECT id, name FROM medicines')).rows.map((r) => [r.name.toLowerCase(), r.id])
        );
        const potMap = new Map(
          (await c.query('SELECT id, name FROM potencies')).rows.map((r) => [r.name.toLowerCase(), r.id])
        );
        const packMap = new Map(
          (await c.query('SELECT id, name FROM pack_sizes')).rows.map((r) => [r.name.toLowerCase(), r.id])
        );

        for (const r of stockRaw) {
          const medName = cell(r, 'Medicine', 'medicine', 'Remedy', 'Name');
          const potName = cell(r, 'Potency', 'potency');
          const packName = cell(r, 'Pack', 'Pack Size', 'pack', 'pack_size', 'Pack Label');
          if (!medName || !potName) continue;

          const qty = num(cell(r, 'Quantity', 'quantity', 'Qty'), 0);
          const minLevel = num(cell(r, 'Min Level', 'min_level', 'Min', 'Minimum'), 0);

          let medId = medMap.get(medName.toLowerCase());
          if (!medId) {
            // Create a minimal medicine if missing
            const ins = await c.query(
              `INSERT INTO medicines (name, material_type)
               VALUES ($1, 'Dilution')
               ON CONFLICT (lower(name)) DO UPDATE SET updated_at = now()
               RETURNING id`,
              [medName]
            );
            medId = ins.rows[0].id;
            medMap.set(medName.toLowerCase(), medId);
            stats.medicinesCreated++;
          }

          let potId = potMap.get(potName.toLowerCase());
          if (!potId) {
            const ins = await c.query(
              `INSERT INTO potencies (name, sort_order)
               VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM potencies))
               RETURNING id`,
              [potName]
            );
            potId = ins.rows[0].id;
            potMap.set(potName.toLowerCase(), potId);
            stats.potencies++;
          }

          const packLabel = packName || 'Default';
          let packId = packMap.get(packLabel.toLowerCase());
          if (!packId) {
            const ins = await c.query(
              `INSERT INTO pack_sizes (name, sort_order)
               VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM pack_sizes))
               RETURNING id`,
              [packLabel]
            );
            packId = ins.rows[0].id;
            packMap.set(packLabel.toLowerCase(), packId);
            stats.packSizes++;
          }

          await c.query(
            `INSERT INTO stock (medicine_id, potency_id, pack_size_id, quantity, min_level)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (medicine_id, potency_id, pack_size_id)
             DO UPDATE SET quantity = EXCLUDED.quantity, min_level = EXCLUDED.min_level, updated_at = now()`,
            [medId, potId, packId, qty, minLevel]
          );
          stats.stockRows++;
        }
      }

      return stats;
    });

    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});


function runCommand(cmd, args, env, inputBuffer = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      if (e.code === 'ENOENT') {
        reject(new Error(
          `${cmd} was not found on the server. Install PostgreSQL client tools `
          + `(psql / pg_restore) or use Excel backup restore instead.`
        ));
      } else reject(e);
    });
    child.on('close', (code) => {
      // pg_restore often exits 1 with only warnings — treat real errors only
      if (code === 0) return resolve({ stdout, stderr, code });
      const errText = (stderr || stdout || '').trim();
      // Ignore benign "errors" when objects already exist during non-clean restore
      if (cmd === 'pg_restore' && !/FATAL|could not/i.test(errText)) {
        return resolve({ stdout, stderr, code });
      }
      reject(new Error(errText || `${cmd} exited with code ${code}`));
    });
    if (inputBuffer) {
      child.stdin.write(inputBuffer);
    }
    child.stdin.end();
  });
}

/**
 * POST /api/backup/restore-sql
 * Automated PostgreSQL restore from a plain .sql (pg_dump) or custom .dump file.
 *
 * Steps:
 *  1. DROP SCHEMA materia CASCADE (wipes current app data only — other schemas untouched)
 *  2. Apply the dump via psql (.sql) or pg_restore (.dump / custom format)
 *  3. Re-run lightweight migrations so columns always match the current app
 *
 * Multipart field: file
 */
router.post('/restore-sql', upload.single('file'), async (req, res, next) => {
  let tmpPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'No SQL/dump file uploaded' });

    const original = (req.file.originalname || '').toLowerCase();
    const isCustom = original.endsWith('.dump')
      || original.endsWith('.backup')
      || original.endsWith('.fc')
      || (req.file.mimetype && req.file.mimetype.includes('octet-stream') && !original.endsWith('.sql'));

    // Detect custom format by header if extension is ambiguous
    let useCustom = isCustom && !original.endsWith('.sql');
    if (!original.endsWith('.sql') && req.file.buffer.length >= 5) {
      // Custom format dumps start with "PGDMP"
      if (req.file.buffer.slice(0, 5).toString('utf8') === 'PGDMP') useCustom = true;
    }
    if (original.endsWith('.sql')) useCustom = false;

    const db = process.env.PGDATABASE || 'hpathy';
    const env = { ...process.env };
    if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD;

    // Write to temp file (pg_restore needs a file path; psql can use stdin but file is fine)
    const ext = useCustom ? '.dump' : '.sql';
    tmpPath = path.join(os.tmpdir(), `hpathy_restore_${Date.now()}${ext}`);
    fs.writeFileSync(tmpPath, req.file.buffer);

    // Wipe only our schema so the dump can recreate it cleanly
    await pool.query('DROP SCHEMA IF EXISTS materia CASCADE');
    await pool.query('CREATE SCHEMA materia');

    if (useCustom) {
      // pg_restore into the database; --schema is filter on restore contents
      await runCommand('pg_restore', [
        '--no-owner',
        '--no-privileges',
        '--dbname', db,
        tmpPath,
      ], env);
    } else {
      // Plain SQL via psql
      await runCommand('psql', [
        '-v', 'ON_ERROR_STOP=1',
        '-d', db,
        '-f', tmpPath,
      ], env);
    }

    // Ensure current app columns/indexes exist (in case dump is from older schema)
    try {
      const { ensureSchema } = await import('../migrate.js');
      await ensureSchema();
    } catch (e) {
      console.warn('[restore-sql] post-migrate warning:', e.message);
    }

    // Quick counts for the response
    const counts = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM materia.medicines) AS medicines,
        (SELECT count(*)::int FROM materia.stock) AS stock,
        (SELECT count(*)::int FROM materia.potencies) AS potencies,
        (SELECT count(*)::int FROM materia.pack_sizes) AS pack_sizes
    `);

    res.json({
      ok: true,
      format: useCustom ? 'custom' : 'plain',
      ...counts.rows[0],
    });
  } catch (err) {
    // Best-effort: if restore failed mid-way, still try to leave schema usable
    try {
      const { ensureSchema } = await import('../migrate.js');
      await ensureSchema();
    } catch { /* ignore */ }
    next(err);
  } finally {
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
});


// GET /api/backup/sql?format=plain|custom
router.get('/sql', async (req, res, next) => {
  const custom = req.query.format === 'custom';
  const stamp = new Date().toISOString().slice(0, 10);
  const db = process.env.PGDATABASE || 'hpathy';

  const args = ['--no-owner', '--no-privileges', '--schema=materia'];
  if (custom) args.push('--format=custom');
  args.push(db);

  const env = { ...process.env };
  if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD;

  const child = spawn('pg_dump', args, { env });

  let started = false;
  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); });

  child.stdout.once('data', () => {
    started = true;
    res.setHeader('Content-Type', custom ? 'application/octet-stream' : 'application/sql');
    res.setHeader('Content-Disposition',
      `attachment; filename="hpathy_backup_${stamp}.${custom ? 'dump' : 'sql'}"`);
  });

  child.stdout.pipe(res);

  child.on('error', (e) => {
    if (res.headersSent) return res.end();
    if (e.code === 'ENOENT') {
      return res.status(500).json({
        error: 'pg_dump was not found on the server. Make sure PostgreSQL\'s bin folder '
          + 'is on PATH, or use the Excel backup instead.',
      });
    }
    next(e);
  });

  child.on('close', (code) => {
    if (code !== 0 && !started) {
      return res.status(500).json({ error: stderr || `pg_dump exited with code ${code}` });
    }
  });
});

export default router;
