import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AbbrConflict, AbbrResolution, Medicine, MedicineListItem } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import Icon from '../components/Icon';

type FormState = Partial<Medicine>;
const MATERIAL_TYPES = ['TRITURATION TABLETS', 'MOTHER TINCTURES', 'DILUTIONS & POTENCIES'] as const;
const EMPTY: FormState = { material_type: 'DILUTIONS & POTENCIES' };

/** Map legacy free-text material types onto the three allowed values. */
function normalizeMaterialType(raw: string | null | undefined): string {
  if (!raw || !String(raw).trim()) return 'DILUTIONS & POTENCIES';
  const s = String(raw).trim();
  if ((MATERIAL_TYPES as readonly string[]).includes(s)) return s;
  const lower = s.toLowerCase();
  if (lower.includes('trituration') || lower.includes('tablet')) return 'TRITURATION TABLETS';
  if (lower.includes('mother') || lower.includes('tincture')) return 'MOTHER TINCTURES';
  if (lower.includes('dilution') || lower.includes('potenc')) return 'DILUTIONS & POTENCIES';
  // Unknown legacy value — default to dilutions so the dropdown is always valid
  return 'DILUTIONS & POTENCIES';
}
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function ManagementPage() {
  const toast = useToast();
  const [items, setItems] = useState<MedicineListItem[]>([]);
  const [search, setSearch] = useState('');
  const [letter, setLetter] = useState('A'); // default view: remedies starting with "A", not the whole catalog
  const [available, setAvailable] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);
  const sqlRestoreRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmAll, setConfirmAll] = useState(false);
  const [conflictState, setConflictState] = useState<{ file: File; conflicts: AbbrConflict[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (q = '', l = letter) => {
    setLoading(true);
    api.listMedicines({ search: q || undefined, letter: q ? undefined : (l || undefined) })
      .then((r) => { setItems(r); setSelected(new Set()); })
      .catch(() => {}).finally(() => setLoading(false));
  };
  const refreshLetters = () => api.letters().then((ls) => setAvailable(new Set(ls))).catch(() => {});
  useEffect(() => { refreshLetters(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(search.trim(), letter), search ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, letter]);

  const openNew = () => setEditing({ ...EMPTY });
  const openEdit = async (id: number) => {
    try {
      const m = await api.getMedicine(id);
      setEditing({ ...m, material_type: normalizeMaterialType(m.material_type) });
    } catch (e) { toast((e as Error).message, 'err'); }
  };

  const remove = async (m: MedicineListItem) => {
    if (!confirm(`Delete "${m.name}" and all its stock?`)) return;
    try { await api.deleteMedicine(m.id); toast('Medicine deleted'); load(search.trim()); refreshLetters(); }
    catch (e) { toast((e as Error).message, 'err'); }
  };

  const toggle = (id: number) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allChecked = items.length > 0 && selected.size === items.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(items.map((m) => m.id)));

  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected remed${selected.size === 1 ? 'y' : 'ies'} and all their stock?`)) return;
    try {
      const r = await api.bulkDeleteMedicines([...selected]);
      toast(`Deleted ${r.deleted} remed${r.deleted === 1 ? 'y' : 'ies'}`);
      load(search.trim()); refreshLetters();
    } catch (e) { toast((e as Error).message, 'err'); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const r = await api.uploadMedicines(file);
      if (r.needsResolution) {
        setConflictState({ file, conflicts: r.conflicts });
        return; // leave `uploading` true — the modal's own button shows progress next
      }
      const extra = r.abbrConflicts ? ` · ${r.abbrConflicts} abbreviation clash${r.abbrConflicts === 1 ? '' : 'es'} skipped` : '';
      toast(`Imported: ${r.created} new, ${r.updated} updated, ${r.stockRows} stock cells${extra}`);
      load(search.trim()); refreshLetters();
    } catch (err) { toast((err as Error).message, 'err'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const resolveConflicts = async (resolutions: Record<string, AbbrResolution>) => {
    if (!conflictState) return;
    setUploading(true);
    try {
      const r = await api.uploadMedicines(conflictState.file, resolutions);
      if (r.needsResolution) throw new Error('Could not resolve all abbreviation clashes'); // shouldn't happen
      const extra = r.abbrConflicts ? ` · ${r.abbrConflicts} abbreviation clash${r.abbrConflicts === 1 ? '' : 'es'} skipped` : '';
      toast(`Imported: ${r.created} new, ${r.updated} updated, ${r.stockRows} stock cells${extra}`);
      setConflictState(null);
      load(search.trim()); refreshLetters();
    } catch (err) { toast((err as Error).message, 'err'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };


  const onRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Restore data from this Excel backup file?')) {
      if (restoreRef.current) restoreRef.current.value = '';
      return;
    }
    const replace = confirm(
      'Replace ALL existing stock with the backup stock sheet?\n\n' +
      'OK = clear current stock, then load backup stock\n' +
      'Cancel = merge (update matching cells, keep other stock)'
    );
    setRestoring(true);
    try {
      const r = await api.restoreBackup(file, replace);
      toast(
        `Restored: ${r.medicinesCreated} new · ${r.medicinesUpdated} updated medicines · ` +
        `${r.stockRows} stock cells · ${r.potencies} potencies · ${r.packSizes} pack sizes` +
        (r.replacedStock ? ' (stock replaced)' : ' (stock merged)')
      );
      load(search.trim());
      refreshLetters();
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally {
      setRestoring(false);
      if (restoreRef.current) restoreRef.current.value = '';
    }
  };

  const onSqlRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(
      'Restore PostgreSQL backup?\n\n' +
      'This will DROP the materia schema and reload everything from the file.\n' +
      'All current app data will be replaced. This cannot be undone.'
    )) {
      if (sqlRestoreRef.current) sqlRestoreRef.current.value = '';
      return;
    }
    setRestoring(true);
    try {
      const r = await api.restoreSqlBackup(file);
      toast(
        `PostgreSQL restore complete (${r.format}): ` +
        `${r.medicines} medicines · ${r.stock} stock · ${r.potencies} potencies · ${r.pack_sizes} pack sizes`
      );
      load(search.trim());
      refreshLetters();
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally {
      setRestoring(false);
      if (sqlRestoreRef.current) sqlRestoreRef.current.value = '';
    }
  };


  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1><Icon name="edit" /> Medicine Management</h1>
          <p>Add and update medicines one by one, or import many at once from Excel.</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Icon name="plus" size={17} /> Add medicine</button>
      </div>

      {/* Backup & Restore */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Backup &amp; Restore</h3>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          Download a full backup of every remedy, pack size, potency and stock level.
          Restore the same Excel file to bring everything back automatically
          (Medicines, Stock, Potencies and Pack Sizes sheets).
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <a className="btn btn-outline" href={api.backupExcelUrl}><Icon name="download" size={16} /> Excel backup (.xlsx)</a>
          <button className="btn btn-primary" disabled={restoring} onClick={() => restoreRef.current?.click()}>
            {restoring ? <><span className="spinner" /> Restoring…</> : <><Icon name="upload" size={16} /> Restore Excel</>}
          </button>
          <input ref={restoreRef} type="file" accept=".xlsx,.xls" hidden onChange={onRestore} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <a className="btn btn-outline" href={api.backupSqlUrl('plain')}><Icon name="download" size={16} /> Postgres (.sql)</a>
          <a className="btn btn-outline" href={api.backupSqlUrl('custom')}><Icon name="download" size={16} /> Postgres (.dump)</a>
          <button className="btn btn-warn" disabled={restoring} onClick={() => sqlRestoreRef.current?.click()}>
            {restoring ? <><span className="spinner" /> Restoring…</> : <><Icon name="upload" size={16} /> Restore Postgres</>}
          </button>
          <input ref={sqlRestoreRef} type="file" accept=".sql,.dump,.backup" hidden onChange={onSqlRestore} />
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          Excel restore merges data. Postgres restore replaces the entire <code>materia</code> schema
          (requires <code>psql</code> / <code>pg_restore</code> on the server).
        </p>
      </div>

      {/* Bulk upload */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Bulk upload</h3>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          Download the Excel format, fill in remedies and per-potency quantities, then upload it.
          Existing remedies are updated by name; if an abbreviation is shared by more than one remedy,
          you'll be asked which one should keep it before anything is imported.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn btn-outline" href={api.templateUrl}><Icon name="download" size={16} /> Download Excel template</a>
          <button className="btn btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <><span className="spinner" /> Uploading…</> : <><Icon name="upload" size={16} /> Upload filled sheet</>}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={onFile} />
        </div>
      </div>

      <div className="search" style={{ marginBottom: 16 }}>
        <span className="ico"><Icon name="search" size={18} /></span>
        <input value={search} placeholder="Search medicines to edit…" onChange={(e) => setSearch(e.target.value)} />
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

      {selected.size > 0 && (
        <div className="bulk-toolbar">
          <span className="count">{selected.size} selected</span>
          <button className="btn btn-danger btn-sm" onClick={deleteSelected}><Icon name="trash" size={15} /> Delete selected</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {loading ? (
        <div className="loading-row"><span className="spinner" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty-state"><div className="ico"><Icon name="edit" /></div><p>No medicines yet. Add one or import a sheet.</p></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input className="chk" type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
                  </th>
                  <th>Medicine</th>
                  <th>Type</th>
                  <th>Pack</th>
                  <th className="center">Total qty</th>
                  <th className="center">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <input className="chk" type="checkbox" checked={selected.has(m.id)}
                        onChange={() => toggle(m.id)} aria-label={`Select ${m.name}`} />
                    </td>
                    <td>
                      <b style={{ color: 'var(--green-800)', fontFamily: 'var(--font-display)' }}>{m.name}</b>
                      {m.abbreviation && <span className="muted"> · {m.abbreviation}</span>}
                      {m.low_stock && <span className="chip chip-low" style={{ marginLeft: 8 }}>Low</span>}
                    </td>
                    <td className="muted">{m.material_type}</td>
                    <td className="muted">
                      {m.pack_size || '—'}
                      {m.pack_size_2 && <> · {m.pack_size_2}</>}
                    </td>
                    <td className="center">{m.total_qty}</td>
                    <td className="center">
                      <span className="order-btns">
                        <button className="icon-btn" onClick={() => openEdit(m.id)} aria-label="Edit"><Icon name="edit" size={16} /></button>
                        <button className="icon-btn danger" onClick={() => remove(m)} aria-label="Delete"><Icon name="trash" size={16} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="danger-zone">
          <span className="dz-text">
            <b>Delete all remedies.</b> Removes every medicine and its stock from the database. This cannot be undone.
          </span>
          <button className="btn btn-danger" onClick={() => setConfirmAll(true)}>Delete all remedies</button>
        </div>
      )}

      {editing && (
        <MedicineForm
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast('Saved'); load(search.trim()); refreshLetters(); }}
        />
      )}

      {confirmAll && (
        <DeleteAllModal
          count={items.length}
          onClose={() => setConfirmAll(false)}
          onDone={() => { setConfirmAll(false); load(); refreshLetters(); }}
        />
      )}

      {conflictState && (
        <AbbrConflictModal
          conflicts={conflictState.conflicts}
          busy={uploading}
          onClose={() => { setConflictState(null); setUploading(false); if (fileRef.current) fileRef.current.value = ''; }}
          onResolve={resolveConflicts}
        />
      )}
    </div>
  );
}

// Shown when the uploaded sheet has an abbreviation that would apply to more
// than one remedy. Lets the person pick, per abbreviation, which remedy keeps
// it — everyone else in that group imports fine but without the abbreviation.
function AbbrConflictModal({ conflicts, busy, onClose, onResolve }: {
  conflicts: AbbrConflict[];
  busy: boolean;
  onClose: () => void;
  onResolve: (resolutions: Record<string, AbbrResolution>) => void;
}) {
  const keyOf = (c: AbbrConflict) => c.abbreviation.toLowerCase();
  const candidateId = (cand: AbbrConflict['candidates'][number]) =>
    cand.type === 'existing' ? `existing:${cand.id}` : `incoming:${cand.name}`;

  const [choices, setChoices] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of conflicts) {
      // Default to whichever remedy already exists in the database, since that
      // preserves what's already linked elsewhere; otherwise the first remedy in the sheet.
      const existing = c.candidates.find((cand) => cand.type === 'existing');
      init[keyOf(c)] = candidateId(existing || c.candidates[0]);
    }
    return init;
  });

  const submit = () => {
    const resolutions: Record<string, AbbrResolution> = {};
    for (const c of conflicts) {
      const key = keyOf(c);
      const choice = choices[key];
      if (choice === 'none') { resolutions[key] = { type: 'none' }; continue; }
      const cand = c.candidates.find((x) => candidateId(x) === choice);
      if (!cand) continue;
      resolutions[key] = cand.type === 'existing'
        ? { type: 'existing', id: cand.id! }
        : { type: 'incoming', name: cand.name };
    }
    onResolve(resolutions);
  };

  return (
    <Modal
      title={`Same abbreviation, ${conflicts.length} remed${conflicts.length === 1 ? 'y' : 'ies'} to choose from`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy ? <><span className="spinner" /> Importing…</> : 'Confirm and import'}
        </button>
      </>}
    >
      <p style={{ marginTop: 0 }} className="muted">
        These abbreviations would end up on more than one remedy. Pick which one keeps each
        abbreviation — the others will still be imported, just without it.
      </p>
      {conflicts.map((c) => {
        const key = keyOf(c);
        return (
          <div key={key} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: 'var(--green-800)', marginBottom: 8 }}>
              Abbreviation "{c.abbreviation}"
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {c.candidates.map((cand) => {
                const id = candidateId(cand);
                return (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, cursor: 'pointer' }}>
                    <input type="radio" name={key} value={id} checked={choices[key] === id}
                      onChange={() => setChoices((p) => ({ ...p, [key]: id }))} />
                    <span>{cand.name}</span>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {cand.type === 'existing' ? '(already in database)' : `(sheet, ${cand.rows} row${cand.rows === 1 ? '' : 's'})`}
                    </span>
                  </label>
                );
              })}
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, cursor: 'pointer' }}>
                <input type="radio" name={key} value="none" checked={choices[key] === 'none'}
                  onChange={() => setChoices((p) => ({ ...p, [key]: 'none' }))} />
                <span className="muted">Leave it off all of them</span>
              </label>
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

function DeleteAllModal({ count, onClose, onDone }: { count: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = text.trim().toUpperCase() === 'DELETE';

  const run = async () => {
    if (!ok) return;
    setBusy(true);
    try { const r = await api.deleteAllMedicines(); toast(`Deleted all ${r.deleted} remedies`); onDone(); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="Delete all remedies?"
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" disabled={!ok || busy} onClick={run}>
          {busy ? <><span className="spinner" /> Deleting…</> : `Delete all ${count}`}
        </button>
      </>}
    >
      <p style={{ marginTop: 0 }}>
        This permanently removes <b>all {count} remedies</b> and their stock. Consider taking a
        backup first. Type <b>DELETE</b> to confirm.
      </p>
      <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETE" />
    </Modal>
  );
}

function MedicineForm({ value, onClose, onSaved }: {
  value: FormState; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<FormState>(value);
  const [busy, setBusy] = useState(false);
  const isEdit = !!f.id;

  const set = (k: keyof FormState, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name || !f.name.trim()) { toast('Name is required', 'err'); return; }
    setBusy(true);
    try {
      if (isEdit) await api.updateMedicine(f.id!, f);
      else await api.createMedicine(f);
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title={isEdit ? 'Edit medicine' : 'Add medicine'}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? <><span className="spinner" /> Saving…</> : 'Save medicine'}
        </button>
      </>}
    >
      <div className="form-grid">
        <div className="field full">
          <label>Latin name (remedy) *</label>
          <input className="input" autoFocus value={f.name || ''} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label>Abbreviation</label>
          <input className="input" value={f.abbreviation || ''} onChange={(e) => set('abbreviation', e.target.value)} placeholder="e.g. Elat." />
        </div>
        <div className="field">
          <label>Kingdom</label>
          <input className="input" value={f.kingdom || ''} onChange={(e) => set('kingdom', e.target.value)} placeholder="Plant / Mineral / Animal" />
        </div>
        <div className="field">
          <label>Common name</label>
          <input className="input" value={f.common_name || ''} onChange={(e) => set('common_name', e.target.value)} placeholder="e.g. Squirting Cucumber" />
        </div>
        <div className="field">
          <label>Material type</label>
          <select
            className="select"
            value={normalizeMaterialType(f.material_type)}
            onChange={(e) => set('material_type', e.target.value)}
          >
            {MATERIAL_TYPES.map((mt) => (
              <option key={mt} value={mt}>{mt}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Pack size</label>
          <input className="input" value={f.pack_size || ''} onChange={(e) => set('pack_size', e.target.value)} placeholder="30 ML" />
        </div>
        <div className="field">
          <label>Pack size 2</label>
          <input className="input" value={f.pack_size_2 || ''} onChange={(e) => set('pack_size_2', e.target.value)} placeholder="100 ML" />
        </div>
        <div className="field full">
          <label>Short description (1–2 lines)</label>
          <input className="input" value={f.short_description || ''} onChange={(e) => set('short_description', e.target.value)}
            placeholder="Helps in Colic, Cramps, Diarrhoea…" />
        </div>
        <div className="field full">
          <label>Indication / Benefits</label>
          <textarea className="textarea" value={f.indications || ''} onChange={(e) => set('indications', e.target.value)}
            placeholder="Full materia-medica notes shown on the detail page…" style={{ minHeight: 140 }} />
        </div>
      </div>
      {isEdit && (
        <p className="muted" style={{ fontSize: 13 }}>
          Tip: configure pack sizes under <b>Pack sizes</b>, then set quantities and minimum levels on the <b>Stock</b> page.
        </p>
      )}
    </Modal>
  );
}
