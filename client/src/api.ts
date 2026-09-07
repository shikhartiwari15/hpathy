import type {
  Medicine, MedicineListItem, Potency, PackSize, StockGrid, LowStockItem,
  AbbrResolution, UploadOutcome, IdentifyResponse,
} from './types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  // Medicines
  listMedicines: (params: { search?: string; letter?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.letter) q.set('letter', params.letter);
    const qs = q.toString();
    return request<MedicineListItem[]>(`/medicines${qs ? '?' + qs : ''}`);
  },
  letters: () => request<string[]>('/medicines/letters'),
  getMedicine: (id: number) => request<Medicine>(`/medicines/${id}`),
  createMedicine: (body: Partial<Medicine>) =>
    request<Medicine>('/medicines', { method: 'POST', body: JSON.stringify(body) }),
  updateMedicine: (id: number, body: Partial<Medicine>) =>
    request<Medicine>(`/medicines/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMedicine: (id: number) =>
    request<{ ok: true }>(`/medicines/${id}`, { method: 'DELETE' }),
  bulkDeleteMedicines: (ids: number[]) =>
    request<{ ok: true; deleted: number }>('/medicines/bulk-delete', {
      method: 'POST', body: JSON.stringify({ ids }),
    }),
  deleteAllMedicines: () =>
    request<{ ok: true; deleted: number }>('/medicines?confirm=DELETE-ALL', { method: 'DELETE' }),
  // Uploads the sheet. If the sheet has an abbreviation shared between two
  // remedies (in the sheet, or vs. an existing remedy), nothing is written and
  // the response describes the conflicts instead — pass the same file back in
  // with `resolutions` (keyed by lowercased abbreviation) to commit the import.
  uploadMedicines: (file: File, resolutions?: Record<string, AbbrResolution>) => {
    const fd = new FormData();
    fd.append('file', file);
    if (resolutions) fd.append('resolutions', JSON.stringify(resolutions));
    return fetch(`${BASE}/medicines/upload`, { method: 'POST', body: fd })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (r.status === 409 && data.needsResolution) return data as UploadOutcome;
        if (!r.ok) throw new Error(data.error || 'Upload failed');
        return data as UploadOutcome;
      });
  },
  templateUrl: `${BASE}/medicines/template/download`,
  backupExcelUrl: `${BASE}/backup/excel`,
  backupSqlUrl: (format: 'plain' | 'custom' = 'plain') =>
    `${BASE}/backup/sql${format === 'custom' ? '?format=custom' : ''}`,
  // Full restore from an Excel backup (Medicines + Stock + Potencies + Pack Sizes).
  // replace=true clears existing stock before applying the Stock sheet.
  restoreBackup: (file: File, replace = false) => {
    const fd = new FormData();
    fd.append('file', file);
    if (replace) fd.append('replace', 'true');
    return fetch(`${BASE}/backup/restore`, { method: 'POST', body: fd })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Restore failed');
        return data as {
          ok: true;
          packSizes: number;
          potencies: number;
          medicinesCreated: number;
          medicinesUpdated: number;
          stockRows: number;
          replacedStock: boolean;
        };
      });
  },
  // Full PostgreSQL restore from plain .sql or custom .dump produced by this app.
  // WARNING: drops and recreates the `materia` schema.
  restoreSqlBackup: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`${BASE}/backup/restore-sql`, { method: 'POST', body: fd })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'SQL restore failed');
        return data as {
          ok: true;
          format: 'plain' | 'custom';
          medicines: number;
          stock: number;
          potencies: number;
          pack_sizes: number;
        };
      });
  },

  // Potencies
  listPotencies: () => request<Potency[]>('/potencies'),
  addPotency: (name: string) =>
    request<Potency>('/potencies', { method: 'POST', body: JSON.stringify({ name }) }),
  renamePotency: (id: number, name: string) =>
    request<Potency>(`/potencies/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deletePotency: (id: number) =>
    request<{ ok: true }>(`/potencies/${id}`, { method: 'DELETE' }),
  reorderPotencies: (order: number[]) =>
    request<{ ok: true }>('/potencies/reorder', { method: 'POST', body: JSON.stringify({ order }) }),

  // Pack sizes (configurable just like potencies)
  listPackSizes: () => request<PackSize[]>('/pack-sizes'),
  addPackSize: (name: string) =>
    request<PackSize>('/pack-sizes', { method: 'POST', body: JSON.stringify({ name }) }),
  renamePackSize: (id: number, name: string) =>
    request<PackSize>(`/pack-sizes/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deletePackSize: (id: number) =>
    request<{ ok: true }>(`/pack-sizes/${id}`, { method: 'DELETE' }),
  reorderPackSizes: (order: number[]) =>
    request<{ ok: true }>('/pack-sizes/reorder', { method: 'POST', body: JSON.stringify({ order }) }),

  // Stock
  stockGrid: (params: { search?: string; letter?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.letter) q.set('letter', params.letter);
    const qs = q.toString();
    return request<StockGrid>(`/stock${qs ? '?' + qs : ''}`);
  },
  addStock: (medicine_id: number, potency_id: number, quantity: number, pack_size_id: number) =>
    request(`/stock/add`, { method: 'POST', body: JSON.stringify({ medicine_id, potency_id, quantity, pack_size_id }) }),
  setStock: (medicine_id: number, potency_id: number, quantity: number, pack_size_id: number) =>
    request(`/stock/set`, { method: 'PUT', body: JSON.stringify({ medicine_id, potency_id, quantity, pack_size_id }) }),
  // levels is keyed by "potencyId:packSizeId", e.g. { "3:1": 5, "3:2": 2 }
  setMinLevels: (medicine_id: number, levels: Record<string, number>) =>
    request(`/stock/min-levels`, { method: 'PUT', body: JSON.stringify({ medicine_id, levels }) }),
  lowStock: () => request<LowStockItem[]>('/stock/low'),

  // Vision scan — reads a homeopathy label via Gemini and matches it against the catalog.
  identifyMedicine: (image: Blob) => {
    const fd = new FormData();
    fd.append('image', image, 'scan.jpg');
    return fetch(`${BASE}/identify`, { method: 'POST', body: fd })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Scan failed');
        return data as IdentifyResponse;
      });
  },
};
