import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'; // retires Oct 16 2026 — bump via env then
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const PROMPT = `Read the label on this homeopathy medicine and return ONLY:
- "name": full canonical remedy name in standard materia medica form; expand
  abbreviations and fix OCR errors, e.g. "Ars Alb" -> "Arsenicum Album".
- "potency": normalized token, e.g. "30C", "200C", "1M", "6X", "Q" (mother
  tincture). Empty string if none visible.
- "confidence": 0 to 1.
If this is not a homeopathy medicine, set name to "" and confidence to 0.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: { name: { type: 'STRING' }, potency: { type: 'STRING' }, confidence: { type: 'NUMBER' } },
  required: ['name', 'potency', 'confidence'],
};

function normalizePotency(raw) {
  if (!raw) return '';
  let p = String(raw).toUpperCase().replace(/\s+/g, '');
  if (/^(MT|Q|Ø|TM)$/.test(p)) return 'Q';
  return p.replace(/CH$/, 'C').replace(/DH$/, 'X');
}

async function readLabel(buffer, mimeType) {
  const res = await fetch(`${ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
      ]}],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from vision service');
  const p = JSON.parse(text);
  return { name: p.name?.trim() || '', potency: normalizePotency(p.potency), confidence: p.confidence ?? 0 };
}

router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set on the server' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded (field name must be "image")' });

    const scan = await readLabel(req.file.buffer, req.file.mimetype || 'image/jpeg');

    // reference lists the confirm UI needs regardless of match
    const potencies = (await pool.query('SELECT id, name FROM potencies ORDER BY sort_order, id')).rows;
    const packSizes = (await pool.query('SELECT id, name FROM pack_sizes ORDER BY sort_order, id')).rows;

    let medicine = null, alternatives = [], matchedPotencyId = null;
    let defaultPackSizeId = packSizes[0]?.id ?? null, currentQty = null;

    if (scan.name) {
      const { rows: meds } = await pool.query(
        `SELECT id, name, common_name, abbreviation, pack_size,
                GREATEST(
                  similarity(lower(name), lower($1)),
                  similarity(lower(coalesce(common_name,'')), lower($1)),
                  similarity(lower(coalesce(abbreviation,'')), lower($1))
                ) AS score,
                (lower(name) = lower($1)) AS exact
         FROM medicines
         ORDER BY exact DESC, score DESC
         LIMIT 5`,
        [scan.name]
      );
      alternatives = meds;
      medicine = meds[0] && (meds[0].exact || meds[0].score >= 0.3) ? meds[0] : null;

      if (scan.potency) {
        const hit = potencies.find(p => p.name.toUpperCase().replace(/\s+/g, '') === scan.potency);
        matchedPotencyId = hit?.id ?? null;
      }
      if (medicine?.pack_size) {
        const ps = packSizes.find(p => p.name.trim().toLowerCase() === medicine.pack_size.trim().toLowerCase());
        if (ps) defaultPackSizeId = ps.id;
      }
      if (medicine && matchedPotencyId && defaultPackSizeId) {
        const { rows } = await pool.query(
          'SELECT quantity FROM stock WHERE medicine_id=$1 AND potency_id=$2 AND pack_size_id=$3',
          [medicine.id, matchedPotencyId, defaultPackSizeId]
        );
        currentQty = rows[0]?.quantity ?? 0;
      }
    }

    res.json({ scan, medicine, alternatives, matchedPotencyId, potencies, packSizes, defaultPackSizeId, currentQty });
  } catch (err) { next(err); }
});

export default router;