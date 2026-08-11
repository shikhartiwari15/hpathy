# Materia Stock — Homoeopathy Medicine Stock Manager

A mobile-friendly web app to keep a *materia medica* of homoeopathy remedies and
track how much of each **medicine × potency** you have on hand. Built with
**React + TypeScript (Vite)** on the front end and **Node.js (Express) + PostgreSQL**
on the back end.

Everything in the requirements document is implemented:

| Page | What it does |
|------|--------------|
| **Home** | A–Z rail + search bar + list of all medicines. Letters with no medicines are disabled. Tap a medicine to open its detail page. |
| **Medicine detail** | Search-with-popup at the top, medicine name + material type, short description, up to **two pack-size boxes**, **potency boxes — tap one and its quantity appears just below**, plus an *Indication / Benefits* tab. |
| **Stock management** | Search + one block per medicine showing a per-potency quantity grid, **Add stock**, and **Min levels** (low-stock alerts fire when a quantity drops below its minimum). |
| **Potency settings** | Add / rename / reorder (↑ ↓) / delete potencies, with per-potency usage counts. |
| **Bulk upload** | Download an Excel template with the exact potency columns, fill it in, and upload — remedies are matched by name and upserted. A duplicate abbreviation is skipped so the rest still import. |
| **Bulk delete** | Select remedies with checkboxes and delete together, or wipe the whole catalogue from a type-to-confirm "Delete all" box. |
| **Backup** | One-click **Excel** backup (re-uploadable to restore) and full **PostgreSQL** dump (`.sql` or compressed `.dump`). |

Each remedy's **abbreviation is unique** (case-insensitive), which stops the same medicine being added twice. Price/MRP has been removed throughout.

## Prerequisites

- **Node.js 18+** (works on Node 22)
- **PostgreSQL** running locally (a native Windows install is fine)

## 1. Database

Create the role and database once (matches the defaults in `.env.example`):

```sql
-- in psql, as a superuser
CREATE ROLE hpathy WITH LOGIN PASSWORD 'hpathy';
CREATE DATABASE hpathy OWNER hpathy;
ALTER ROLE hpathy CREATEDB;
```

## 2. Backend

```bash
cd server
copy .env.example .env      # Windows  (use: cp .env.example .env  on macOS/Linux)
npm install
npm run db:setup            # creates the tables
npm run db:seed             # optional: 12 potencies + 17 sample medicines
npm run dev                 # API on http://localhost:4000
```

Adjust `.env` if your Postgres uses a different user/password/port.

## 3. Frontend

In a second terminal:

```bash
cd client
npm install
npm run dev                 # app on http://localhost:5173
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` to the
backend on port 4000, so no CORS setup is needed during development.

## Production build

```bash
cd client && npm run build   # outputs static files to client/dist
```

Serve `client/dist` from any static host and point it at the running API
(set up a reverse proxy for `/api`, or enable CORS — the server already sends
permissive CORS headers).

## Project layout

```
hpathy-app/
├── server/                 # Express + PostgreSQL API
│   ├── schema.sql          # tables: medicines, potencies, stock
│   ├── scripts/setup.js    # applies schema.sql
│   ├── scripts/seed.js     # default potencies + sample medicines
│   └── src/
│       ├── index.js        # app entry
│       ├── db.js           # pg pool + transaction helper
│       └── routes/         # medicines.js, potencies.js, stock.js
└── client/                 # React + TypeScript (Vite)
    └── src/
        ├── api.ts          # typed API client
        ├── pages/          # Home, MedicineDetail, Stock, Management, Potency
        └── components/     # Layout, MedicineSearch, Modal, Toast
```

## Data model

- **medicines** — name, abbreviation, kingdom, common name, material type, pack size, MRP, short description, indications.
- **potencies** — name + display order (Q/1X, 2X … 1M, 10M).
- **stock** — quantity and minimum level for each `(medicine, potency)` pair.

## API reference (short)

```
GET    /api/medicines?search=&letter=      list (with total qty + low flag)
GET    /api/medicines/letters              A–Z letters that have medicines
GET    /api/medicines/:id                  detail incl. per-potency stock
POST   /api/medicines                       create
PUT    /api/medicines/:id                   update
DELETE /api/medicines/:id                   delete
POST   /api/medicines/bulk                  upsert an array of rows
POST   /api/medicines/bulk-delete           delete { ids: [...] }
DELETE /api/medicines?confirm=DELETE-ALL    delete every medicine
GET    /api/medicines/template/download     Excel upload template (.xlsx)
POST   /api/medicines/upload                import a filled .xlsx

GET    /api/backup/excel                     full backup workbook (.xlsx)
GET    /api/backup/sql?format=plain|custom   PostgreSQL dump (.sql / .dump)

GET    /api/potencies                       list with usage stats
POST   /api/potencies                       add
PUT    /api/potencies/:id                   rename
DELETE /api/potencies/:id                   delete
POST   /api/potencies/reorder               { order: [id, ...] }

GET    /api/stock?search=                    per-medicine potency grid
GET    /api/stock/low                        everything below its minimum
POST   /api/stock/add                        add to a quantity
PUT    /api/stock/set                        set an absolute quantity
PUT    /api/stock/min-levels                 set minimum levels for a medicine
```

## Backups

- **Excel backup** (`/api/backup/excel`) produces a workbook with three sheets — *Medicines* (in the bulk-upload format, so it can be re-uploaded to restore), *Stock*, and *Potencies*.
- **PostgreSQL backup** (`/api/backup/sql`) runs `pg_dump` for the `materia` schema. For this to work, PostgreSQL's `bin` folder (which contains `pg_dump`) must be on the system `PATH` — on a native Windows install that's usually `C:\Program Files\PostgreSQL\16\bin`. Restore a `.sql` file with `psql -d hpathy -f backup.sql`, or a `.dump` with `pg_restore`.

## Notes for next steps

- This covers the medicine + potency + stock spec. Your existing app also has
  issue/return history, patients and prescriptions, and a webcam-OCR label
  reader — those can slot on top of this same schema and API when you're ready.
- The webcam OCR feature would add a `POST /api/scan` endpoint (image in →
  medicine name + potency out) and reuse the search/add-stock flow already here.
