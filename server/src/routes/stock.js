import { Router } from 'express';
import { pool, withTransaction } from '../db.js';

const router = Router();

// GET /api/stock?search=&letter=  -> medicines with a quantity map across every potency × pack size.
// Shape: {
//   potencies: [{id,name}],
//   pack_sizes: [{id,name}],
//   medicines: [{id,name,total,low, qty:{potency_id:{pack_size_id:{quantity,min_level}}}}]
// }
router.get('/', async (req, res, next) => {
  try {
    const { search, letter } = req.query;
    const potencies = (await pool.query(
      'SELECT id, name FROM potencies ORDER BY sort_order ASC, id ASC'
    )).rows;
    const pack_sizes = (await pool.query(
      'SELECT id, name FROM pack_sizes ORDER BY sort_order ASC, id ASC'
    )).rows;

    const params = [];
    const where = [];
    if (search) { params.push(`%${search}%`); where.push(`(m.name ILIKE $${params.length} OR m.abbreviation ILIKE $${params.length})`); }
    if (letter) { params.push(`${letter}%`); where.push(`m.name ILIKE $${params.length}`); }

    const medRows = (await pool.query(
      `SELECT id, name, abbreviation, common_name, pack_size, pack_size_2 FROM medicines m
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name ASC`,
      params
    )).rows;

    const medIds = medRows.map((m) => m.id);
    const stockRows = medIds.length ? (await pool.query(
      `SELECT medicine_id, potency_id, pack_size_id, quantity, min_level FROM stock WHERE medicine_id = ANY($1::int[])`,
      [medIds]
    )).rows : [];

    const byMed = new Map();
    for (const s of stockRows) {
      if (!byMed.has(s.medicine_id)) byMed.set(s.medicine_id, {});
      const medMap = byMed.get(s.medicine_id);
      if (!medMap[s.potency_id]) medMap[s.potency_id] = {};
      medMap[s.potency_id][s.pack_size_id] = { quantity: s.quantity, min_level: s.min_level };
    }

    const medicines = medRows.map(m => {
      const qty = byMed.get(m.id) || {};
      let total = 0, low = false;
      for (const cell of Object.values(qty)) {
        for (const packCell of Object.values(cell)) {
          total += packCell.quantity;
          if (packCell.min_level > 0 && packCell.quantity < packCell.min_level) low = true;
        }
      }
      return { ...m, qty, total, low };
    });

    res.json({ potencies, pack_sizes, medicines });
  } catch (err) { next(err); }
});

// GET /api/stock/low  -> flat list of every (potency, pack size) below its minimum level
router.get('/low', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id AS medicine_id, m.name AS medicine, p.name AS potency,
             s.pack_size_id, ps.name AS pack_label,
             s.quantity, s.min_level
      FROM stock s
      JOIN medicines m ON m.id = s.medicine_id
      JOIN potencies p ON p.id = s.potency_id
      JOIN pack_sizes ps ON ps.id = s.pack_size_id
      WHERE s.min_level > 0 AND s.quantity < s.min_level
      ORDER BY (s.min_level - s.quantity) DESC, m.name ASC`);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/stock/add  -> body: { medicine_id, potency_id, quantity, pack_size_id }
router.post('/add', async (req, res, next) => {
  try {
    const { medicine_id, potency_id, quantity, pack_size_id } = req.body;
    const qty = Number(quantity);
    const psid = Number(pack_size_id);
    if (!medicine_id || !potency_id || !Number.isFinite(qty) || !Number.isFinite(psid)) {
      return res.status(400).json({ error: 'medicine_id, potency_id, pack_size_id and quantity are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO stock (medicine_id, potency_id, pack_size_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (medicine_id, potency_id, pack_size_id)
       DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity, updated_at = now()
       RETURNING *`,
      [medicine_id, potency_id, psid, qty]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/stock/set  -> body: { medicine_id, potency_id, quantity, pack_size_id }
router.put('/set', async (req, res, next) => {
  try {
    const { medicine_id, potency_id, quantity, pack_size_id } = req.body;
    const qty = Number(quantity);
    const psid = Number(pack_size_id);
    if (!medicine_id || !potency_id || !Number.isFinite(qty) || !Number.isFinite(psid)) {
      return res.status(400).json({ error: 'medicine_id, potency_id, pack_size_id and quantity are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO stock (medicine_id, potency_id, pack_size_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (medicine_id, potency_id, pack_size_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()
       RETURNING *`,
      [medicine_id, potency_id, psid, qty]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/stock/min-levels -> body: { medicine_id, levels: { "potencyId:packSizeId": min, ... } }
router.put('/min-levels', async (req, res, next) => {
  try {
    const { medicine_id, levels } = req.body;
    if (!medicine_id || typeof levels !== 'object') {
      return res.status(400).json({ error: 'medicine_id and levels are required' });
    }
    await withTransaction(async (c) => {
      for (const [key, min] of Object.entries(levels)) {
        const [potency_id, packPart] = String(key).split(':');
        const psid = Number(packPart);
        if (!Number.isFinite(psid)) continue;
        const minLevel = Number(min) || 0;
        await c.query(
          `INSERT INTO stock (medicine_id, potency_id, pack_size_id, quantity, min_level)
           VALUES ($1,$2,$3,0,$4)
           ON CONFLICT (medicine_id, potency_id, pack_size_id)
           DO UPDATE SET min_level = EXCLUDED.min_level, updated_at = now()`,
          [medicine_id, potency_id, psid, minLevel]
        );
      }
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
