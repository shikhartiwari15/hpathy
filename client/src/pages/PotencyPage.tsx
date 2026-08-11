import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Potency } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import Icon from '../components/Icon';

export default function PotencyPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Potency[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Potency | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.listPotencies().then(setRows).catch((e) => toast(e.message, 'err')).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await api.addPotency(name.trim()); setName(''); setAdding(false); toast('Potency added'); load(); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  const rename = async () => {
    if (!editing || !editing.name.trim()) return;
    setBusy(true);
    try { await api.renamePotency(editing.id, editing.name.trim()); setEditing(null); toast('Renamed'); load(); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  const remove = async (p: Potency) => {
    if (!confirm(`Delete potency "${p.name}"? This also removes its stock records.`)) return;
    try { await api.deletePotency(p.id); toast('Potency deleted'); load(); }
    catch (e) { toast((e as Error).message, 'err'); }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    try { await api.reorderPotencies(next.map((p) => p.id)); }
    catch (e) { toast((e as Error).message, 'err'); load(); }
  };

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1><Icon name="sliders" /> Potency Settings</h1>
          <p>Add, rename, reorder, and remove the potencies used across the system.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={17} /> Add Potency</button>
      </div>

      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 14 }}>
          <h3 style={{ fontSize: 16 }}>Configured potencies</h3>
        </div>
        {loading ? (
          <div className="loading-row"><span className="spinner" /> Loading…</div>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Potency name</th>
                  <th>In stock records</th>
                  <th className="center">Order</th>
                  <th className="center">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <button className="potency-name-pill" onClick={() => setEditing({ ...p })}
                        title="Click to rename">{p.name}</button>
                    </td>
                    <td className="muted">
                      {p.medicine_count} medicine(s) · {p.total_units} units
                    </td>
                    <td className="center">
                      <span className="order-btns">
                        <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><Icon name="up" size={16} /></button>
                        <button className="icon-btn" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><Icon name="down" size={16} /></button>
                      </span>
                    </td>
                    <td className="center">
                      <button className="icon-btn danger" onClick={() => remove(p)} aria-label="Delete"><Icon name="trash" size={16} /></button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="center muted" style={{ padding: 30 }}>No potencies yet. Add your first one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && (
        <Modal
          title="Add potency"
          onClose={() => setAdding(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={add}>Add potency</button>
          </>}
        >
          <div className="field">
            <label>Potency name</label>
            <input className="input" autoFocus value={name} placeholder="e.g. 50M, CM, 3C…"
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </div>
          <p className="muted" style={{ fontSize: 13 }}>New potencies are added to the end of the list. Use the arrows to reorder.</p>
        </Modal>
      )}

      {editing && (
        <Modal
          title="Rename potency"
          onClose={() => setEditing(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !editing.name.trim()} onClick={rename}>Save</button>
          </>}
        >
          <div className="field">
            <label>Potency name</label>
            <input className="input" autoFocus value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && rename()} />
          </div>
        </Modal>
      )}
    </div>
  );
}
