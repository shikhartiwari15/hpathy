export interface MedicineListItem {
  id: number;
  name: string;
  abbreviation: string | null;
  material_type: string;
  pack_size: string | null;
  pack_size_2: string | null;
  short_description: string | null;
  total_qty: number;
  low_stock: boolean;
}

export interface StockCell {
  potency_id: number;
  potency: string;
  sort_order: number;
  pack_size_id: number;
  pack_size: string;
  pack_sort: number;
  quantity: number;
  min_level: number;
}

export interface Medicine {
  id: number;
  name: string;
  abbreviation: string | null;
  kingdom: string | null;
  common_name: string | null;
  material_type: string;
  pack_size: string | null;
  pack_size_2: string | null;
  short_description: string | null;
  indications: string | null;
  pack_sizes: { id: number; name: string; sort_order: number }[];
  stock: StockCell[];
}

export interface Potency {
  id: number;
  name: string;
  sort_order: number;
  medicine_count: number;
  total_units: number;
}

export interface PackSize {
  id: number;
  name: string;
  sort_order: number;
  medicine_count: number;
  total_units: number;
}

// qty: potency_id -> pack_size_id -> cell
export interface StockGridMedicine {
  id: number;
  name: string;
  abbreviation: string | null;
  common_name: string | null;
  pack_size: string | null;
  pack_size_2: string | null;
  qty: Record<number, Record<number, { quantity: number; min_level: number }>>;
  total: number;
  low: boolean;
}

export interface StockGrid {
  potencies: { id: number; name: string }[];
  pack_sizes: { id: number; name: string }[];
  medicines: StockGridMedicine[];
}

export interface LowStockItem {
  medicine_id: number;
  medicine: string;
  potency: string;
  pack_size_id: number;
  pack_label: string | null;
  quantity: number;
  min_level: number;
}

export interface AbbrConflictCandidate {
  type: 'incoming' | 'existing';
  name: string;
  id?: number;    // present when type === 'existing'
  rows?: number;  // present when type === 'incoming' — how many sheet rows use it
}

export interface AbbrConflict {
  abbreviation: string;
  candidates: AbbrConflictCandidate[];
}

export type AbbrResolution =
  | { type: 'incoming'; name: string }
  | { type: 'existing'; id: number }
  | { type: 'none' };

export interface UploadResult {
  created: number;
  updated: number;
  stockRows: number;
  parsedRows: number;
  abbrConflicts: number;
  needsResolution?: false;
}

export interface UploadNeedsResolution {
  needsResolution: true;
  conflicts: AbbrConflict[];
}

export type UploadOutcome = UploadResult | UploadNeedsResolution;

// Vision-scan (/api/identify) response
export interface IdentifyMatch {
  id: number;
  name: string;
  common_name?: string;
  abbreviation?: string;
  score?: number;
  exact?: boolean;
}

export interface IdentifyResponse {
  scan: { name: string; potency: string; confidence: number };
  medicine: IdentifyMatch | null;
  alternatives: IdentifyMatch[];
  matchedPotencyId: number | null;
  potencies: { id: number; name: string }[];
  packSizes: { id: number; name: string }[];
  defaultPackSizeId: number | null;
  currentQty: number | null;
}
