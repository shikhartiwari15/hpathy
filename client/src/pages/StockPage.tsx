import { useEffect, useState } from 'react';
import { api } from '../api';
import type { StockGrid, StockGridMedicine, LowStockItem } from '../types';
import Modal from '../components/Modal';
import ScanMedicineModal from '../components/MedicineScanner';
import { useToast } from '../components/Toast';
import Icon from '../components/Icon';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function StockPage() {
  const toast = useToast();
  const [grid, setGrid] = useState<StockGrid | null>(null);
  const [search, setSearch] = useState('');
  const [letter, setLetter] = useState('A');
  const [available, setAvailable] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [low, setLow] = useState<LowStockItem[]>([]);

  const [addFor, setAddFor] = useState<StockGridMedicine | null>(null);
  const [minFor, setMinFor] = useState<StockGridMedicine | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => { api.letters().then((ls) => setAvailable(new Set(ls))).catch(() => {}); }, []);
  useEffect(() => { api.lowStock().then(setLow).catch(() => {}); }, []);

  const load = (q: string, l: string) => {
    setLoading(true);
    api.stockGrid({ search: q || undefined, letter: q ? undefined : (l || undefined) })
      .then(setGrid).catch((e) => toast(e.message, 'err')).finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(() => load(search.trim(), letter), search ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, letter]);

  const refreshLow = () => { api.lowStock().then(setLow).catch(() => {}); };

  const clearCell = async (medicineId: number, potencyId: number, packSizeId: number, key: string) => {
    if (!window.confirm('Remove this stock entry? This sets its quantity to 0.')) return;
    setClearing(key);
    try {
      await api.setStock(medicineId, potencyId, 0, packSizeId);
      load(search.trim(), letter);
      refreshLow();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setClearing(null);
    }
  };

  const packs = grid?.pack_sizes ?? [];

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1><Icon name="box" /> Stock Management</h1>
          <p>View stock levels and add stock to any medicine / potency / pack size.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setScanning(true)}>
          <Icon name="camera" size={17} /> Scan medicine
        </button>
      </div>

      {low.length > 0 && (
        <div className="alert-banner">
          <Icon name="alert" /> <b>{low.length}</b> potency record(s) are below their minimum level.
        </div>
      )}

      <div className="search" style={{ marginBottom: 16 }}>
        <span className="ico"><Icon name="search" size={18} /></span>
        <input value={search} placeholder="Type medicine name to search…"
          onChange={(e) => setSearch(e.target.value)} />
        {search && <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear</button>}
      </div>

      <div className="az">
        <button className={!search && letter === '' ? 'active' : ''} onClick={() => { setLetter(''); setSearch(''); }}>All</button>
        {ALPHABET.map((l) => (
          <button
            key={l}
            className={!search && letter === l ? 'active' : ''}
            disabled={!available.has(l)}
            onClick={() => { setLetter(l); setSearch(''); }}
          >
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-row"><span className="spinner" /> Loading stock…</div>
      ) : !grid || grid.medicines.length === 0 ? (
        <div className="empty-state"><div className="ico"><Icon name="box" /></div><p>No medicines to show. Try another letter.</p></div>
      ) : packs.length === 0 ? (
        <div className="empty-state">
          <div className="ico"><Icon name="box" /></div>
          <p>No pack sizes configured. Add pack sizes under <b>Pack sizes</b> first.</p>
        </div>
      ) : (
        grid.medicines.map((m) => {
          // Only show pack sizes that actually have stock for this medicine.
          const medPacks = packs.filter((ps) =>
            grid.potencies.some((p) => (m.qty[p.id]?.[ps.id]?.quantity ?? 0) > 0)
          );

          return (
            <div key={m.id} className="stock-block">
              <div className="head">
                <span className="nm">
                  <Icon name="leaf" /> {m.name}
                  {m.common_name && <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>({m.common_name})</span>}
                  {m.low && <span className="chip chip-low">Low</span>}
                </span>
                <span className="actions">
                  <button className="btn btn-warn btn-sm" onClick={() => setMinFor(m)}><Icon name="alert" size={15} /> Min levels</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setAddFor(m)}><Icon name="plus" size={15} /> Add stock</button>
                </span>
              </div>
              {medPacks.length === 0 ? (
                <p className="no-stock">No stock recorded yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="grid">
                    <thead>
                      <tr>
                        {packs.length > 1 && <th style={{ width: 90 }}>Pack</th>}
                        {grid.potencies.map((p) => <th key={p.id} className="center">{p.name}</th>)}
                        <th className="total-h">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {medPacks.map((ps) => {
                        let rowTotal = 0;
                        return (
                          <tr key={ps.id}>
                            {packs.length > 1 && (
                              <td className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{ps.name}</td>
                            )}
                            {grid.potencies.map((p) => {
                              const cell = m.qty[p.id]?.[ps.id];
                              const q = cell?.quantity ?? 0;
                              rowTotal += q;
                              const isLow = cell && cell.min_level > 0 && q < cell.min_level;
                              const key = `${m.id}:${p.id}:${ps.id}`;
                              return (
                                <td key={p.id} className={`qty ${q === 0 ? 'zero' : ''} ${isLow ? 'low' : ''}`}>
                                  {q === 0 ? '·' : (
                                    <span className="qty-cell">
                                      <span>{q}</span>
                                      <button
                                        type="button"
                                        className="qty-del"
                                        title="Remove this stock entry"
                                        disabled={clearing === key}
                                        onClick={() => clearCell(m.id, p.id, ps.id, key)}
                                      >
                                        <Icon name="x" size={11} />
                                      </button>
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="total">{rowTotal}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}

      {scanning && (
        <ScanMedicineModal
          onClose={() => setScanning(false)}
          onAdded={(label) => { setScanning(false); toast(label); load(search.trim(), letter); refreshLow(); }}
        />
      )}
      {addFor && grid && (
        <AddStockModal
          medicine={addFor}
          potencies={grid.potencies}
          packSizes={grid.pack_sizes}
          onClose={() => setAddFor(null)}
          onSaved={() => { setAddFor(null); toast('Stock added'); load(search.trim(), letter); refreshLow(); }}
        />
      )}
      {minFor && grid && (
        <MinLevelModal
          medicine={minFor}
          potencies={grid.potencies}
          packSizes={grid.pack_sizes}
          onClose={() => setMinFor(null)}
          onSaved={() => { setMinFor(null); toast('Minimum levels saved'); load(search.trim(), letter); refreshLow(); }}
        />
      )}
    </div>
  );
}

function AddStockModal({ medicine, potencies, packSizes, onClose, onSaved }: {
  medicine: StockGridMedicine;
  potencies: { id: number; name: string }[];
  packSizes: { id: number; name: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [potencyId, setPotencyId] = useState(potencies[0]?.id ?? 0);
  const [packSizeId, setPackSizeId] = useState(packSizes[0]?.id ?? 0);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const current = medicine.qty[potencyId]?.[packSizeId]?.quantity ?? 0;

  const save = async () => {
    setBusy(true);
    try { await api.addStock(medicine.id, potencyId, qty, packSizeId); onSaved(); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Add stock — ${medicine.name}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || qty < 1 || !packSizeId} onClick={save}>Add {qty} unit(s)</button>
      </>}
    >
      {packSizes.length > 1 && (
        <div className="field">
          <label>Pack size</label>
          <select className="select" value={packSizeId} onChange={(e) => setPackSizeId(Number(e.target.value))}>
            {packSizes.map((ps) => (
              <option key={ps.id} value={ps.id}>{ps.name}</option>
            ))}
          </select>
        </div>
      )}
      {packSizes.length === 1 && (
        <p className="muted" style={{ fontSize: 13, marginTop: -8, marginBottom: 0 }}>
          Pack size: <b>{packSizes[0].name}</b>
        </p>
      )}
      <div className="field">
        <label>Potency</label>
        <select className="select" value={potencyId} onChange={(e) => setPotencyId(Number(e.target.value))}>
          {potencies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {medicine.qty[p.id]?.[packSizeId]?.quantity ?? 0} in stock
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Quantity to add</label>
        <div className="qty-stepper">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease"><Icon name="down" size={18} /></button>
          <input type="number" min={1} value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
          <button onClick={() => setQty((q) => q + 1)} aria-label="Increase"><Icon name="plus" size={18} /></button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Current: {current} → New total: <b>{current + qty}</b>
      </p>
    </Modal>
  );
}

function MinLevelModal({ medicine, potencies, packSizes, onClose, onSaved }: {
  medicine: StockGridMedicine;
  potencies: { id: number; name: string }[];
  packSizes: { id: number; name: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  // Keyed by "potencyId:packSizeId"
  const [levels, setLevels] = useState<Record<string, number>>(
    Object.fromEntries(
      potencies.flatMap((p) => packSizes.map((ps) => [`${p.id}:${ps.id}`, medicine.qty[p.id]?.[ps.id]?.min_level ?? 0]))
    )
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try { await api.setMinLevels(medicine.id, levels); onSaved(); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Minimum levels — ${medicine.name}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Save min levels</button>
      </>}
    >
      <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
        A low-stock alert shows when a potency's quantity falls below its minimum. Set 0 to disable.
      </p>
      {packSizes.map((ps) => (
        <div key={ps.id}>
          {packSizes.length > 1 && (
            <div className="section-label" style={{ marginTop: 12 }}>
              {ps.name}
            </div>
          )}
          <div className="form-grid">
            {potencies.map((p) => {
              const key = `${p.id}:${ps.id}`;
              return (
                <div className="field" key={key}>
                  <label>{p.name}</label>
                  <input className="input" type="number" min={0} value={levels[key] ?? 0}
                    onChange={(e) => setLevels({ ...levels, [key]: Math.max(0, Number(e.target.value) || 0) })} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Modal>
  );
}
