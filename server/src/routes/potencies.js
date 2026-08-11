import { Router } from 'express';
import { pool, withTransaction } from '../db.js';

const router = Router();

// GET /api/potencies -> ordered list with usage stats (for the settings page)
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.sort_order,
             COUNT(s.id) FILTER (WHERE s.quantity > 0)::int AS medicine_count,
             COALESCE(SUM(s.quantity), 0)::int AS total_units
      FROM potencies p
      LEFT JOIN stock s ON s.potency_id = p.id
      GROUP BY p.id
      ORDER BY p.sort_order ASC, p.id ASC`);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/potencies -> add (appended to the end)
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Potency name is required' });
    const { rows } = await pool.query(
      `INSERT INTO potencies (name, sort_order)
       VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM potencies))
       RETURNING *`,
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That potency already exists' });
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Potency name is required' });
    const { rows } = await pool.query(
      'UPDATE potencies SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Potency not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That potency already exists' });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM potencies WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Potency not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/potencies/reorder -> body: { order: [id, id, ...] }
router.post('/reorder', async (req, res, next) => {
  try {
    const order = req.body.order;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Expected { order: [...] }' });
    await withTransaction(async (c) => {
      for (let i = 0; i < order.length; i++) {
        await c.query('UPDATE potencies SET sort_order=$1 WHERE id=$2', [i + 1, order[i]]);
      }
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
