import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import medicines from './routes/medicines.js';
import potencies from './routes/potencies.js';
import packSizes from './routes/pack_sizes.js';
import stock from './routes/stock.js';
import backup from './routes/backup.js';
import { ensureSchema } from './migrate.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/medicines', medicines);
app.use('/api/potencies', potencies);
app.use('/api/pack-sizes', packSizes);
app.use('/api/stock', stock);
app.use('/api/backup', backup);

// Central error handler so routes can just call next(err).
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const port = process.env.PORT || 4000;

// Apply pending column/table migrations, then listen.
ensureSchema()
  .then(() => {
    app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
  })
  .catch((err) => {
    console.error('Failed to migrate schema:', err);
    process.exit(1);
  });
