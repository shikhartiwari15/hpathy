import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
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

// ---- Serve the compiled React frontend (single-service deployment) ----
// The Vite build lands in client/dist. Serving it from the same origin as the
// API means there's no CORS to configure and only ONE service to deploy: the
// Express server is the whole app.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// SPA fallback: any non-API GET returns index.html so client-side routing
// (react-router) works on hard refresh / deep links. API paths fall through
// to the 404/error handling below instead of being handed the HTML shell.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

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
