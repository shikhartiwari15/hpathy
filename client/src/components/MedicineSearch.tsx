import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { MedicineListItem } from '../types';
import Icon from './Icon';

interface Props {
  placeholder?: string;
  onSelect: (m: MedicineListItem) => void;
}

// Search input that shows a popup of matching medicines as you type.
export default function MedicineSearch({ placeholder = 'Search medicines by name…', onSelect }: Props) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<MedicineListItem[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (term.trim().length < 1) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const rows = await api.listMedicines({ search: term.trim() });
        setResults(rows.slice(0, 12));
        setHi(0);
        setOpen(true);
      } catch { /* ignore */ }
    }, 180);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (m: MedicineListItem) => {
    onSelect(m);
    setTerm('');
    setResults([]);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[hi]); }
  };

  return (
    <div className="search" ref={boxRef}>
      <span className="ico"><Icon name="search" size={18} /></span>
      <input
        value={term}
        placeholder={placeholder}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => term && setOpen(true)}
        onKeyDown={onKey}
      />
      {open && term.trim() && (
        <div className="search-pop">
          {results.length === 0 ? (
            <div className="empty">No medicines match "{term}"</div>
          ) : (
            results.map((m, i) => (
              <button key={m.id} className={i === hi ? 'hi' : ''} onClick={() => pick(m)}>
                <span className="nm">{m.name}</span>
                <span className="sub">
                  {m.material_type} · {m.total_qty} in stock
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
