import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { MedicineListItem } from '../types';
import Icon from '../components/Icon';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function HomePage() {
  const nav = useNavigate();
  const [letter, setLetter] = useState<string>('A'); // default view: remedies starting with "A", not the whole catalog
  const [search, setSearch] = useState('');
  const [available, setAvailable] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<MedicineListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.letters().then((ls) => setAvailable(new Set(ls))).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.listMedicines({ letter: letter || undefined, search: search.trim() || undefined })
        .then(setItems)
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, search ? 180 : 0);
    return () => clearTimeout(t);
  }, [letter, search]);

  const heading = useMemo(() => {
    if (search) return `Results for "${search}"`;
    if (letter) return `Medicines — ${letter}`;
    return 'All medicines';
  }, [letter, search]);

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1><Icon name="leaf" /> Materia Medica</h1>
          <p>Browse your remedies, check stock, and open any medicine for details.</p>
        </div>
      </div>

      <div className="search" style={{ marginBottom: 16 }}>
        <span className="ico"><Icon name="search" size={18} /></span>
        <input
          value={search}
          placeholder="Search all medicines…"
          onChange={(e) => { setSearch(e.target.value); setLetter(''); }}
        />
        {search && (
          <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear</button>
        )}
      </div>

      <div className="az">
        <button className={letter === '' ? 'active' : ''} onClick={() => { setLetter(''); setSearch(''); }}>All</button>
        {ALPHABET.map((l) => (
          <button
            key={l}
            className={letter === l ? 'active' : ''}
            disabled={!available.has(l)}
            onClick={() => { setLetter(l); setSearch(''); }}
          >
            {l}
          </button>
        ))}
      </div>

      <h2 style={{ fontSize: 16, margin: '4px 2px 14px', color: 'var(--muted)', fontWeight: 600 }}>
        {heading} · {items.length}
      </h2>

      {loading ? (
        <div className="loading-row"><span className="spinner" /> Loading medicines…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="ico"><Icon name="search" /></div>
          <p>No medicines found. Try another letter, or add medicines from the Manage page.</p>
        </div>
      ) : (
        <div className="med-list">
          {items.map((m) => (
            <button key={m.id} className="med-card" onClick={() => nav(`/medicine/${m.id}`)}>
              <div className="row1">
                <span className="name">{m.name}</span>
                {m.abbreviation && <span className="abbr">{m.abbreviation}</span>}
              </div>
              {m.short_description && <div className="desc">{m.short_description}</div>}
              <div className="meta">
                <span className="chip chip-type">{m.material_type}</span>
                <span className="chip chip-green">{m.total_qty} in stock</span>
                {m.low_stock && <span className="chip chip-low">Low stock</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
