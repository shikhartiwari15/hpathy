import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Medicine, StockCell } from '../types';
import MedicineSearch from '../components/MedicineSearch';
import Icon from '../components/Icon';

export default function MedicineDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [med, setMed] = useState<Medicine | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPotencyId, setSelectedPotencyId] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setSelectedPotencyId(null);
    api.getMedicine(Number(id))
      .then((m) => {
        setMed(m);
        // Preselect the first potency that has any stock, else the first potency.
        const withStock = m.stock.find((s) => s.quantity > 0);
        setSelectedPotencyId(withStock?.potency_id ?? m.stock[0]?.potency_id ?? null);
      })
      .catch(() => setMed(null))
      .finally(() => setLoading(false));
  }, [id]);

  const potencyIds = useMemo(() => {
    if (!med) return [] as { id: number; name: string; total: number }[];
    const map = new Map<number, { id: number; name: string; total: number }>();
    for (const s of med.stock) {
      if (!map.has(s.potency_id)) map.set(s.potency_id, { id: s.potency_id, name: s.potency, total: 0 });
      map.get(s.potency_id)!.total += s.quantity;
    }
    return [...map.values()];
  }, [med]);

  // Only pack sizes that actually have stock for the selected potency
  const cellsForSelected: StockCell[] = useMemo(() => {
    if (!med || selectedPotencyId == null) return [];
    return med.stock.filter((s) => s.potency_id === selectedPotencyId && s.quantity > 0);
  }, [med, selectedPotencyId]);

  if (loading) return <div className="loading-row"><span className="spinner" /> Loading…</div>;
  if (!med) return (
    <div className="empty-state"><div className="ico"><Icon name="alert" /></div><p>Medicine not found.</p></div>
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <MedicineSearch onSelect={(m) => nav(`/medicine/${m.id}`)} />
      </div>

      <button className="btn btn-ghost btn-sm" onClick={() => nav('/')} style={{ marginBottom: 10 }}>
        <Icon name="back" size={16} /> Back to all medicines
      </button>

      <div className="card card-pad detail-head">
        <h1>{med.name}</h1>
        <div className="detail-sub">
          <span>{med.material_type}</span>
          {med.common_name && <><span className="dot" /><span>{med.common_name}</span></>}
          {med.kingdom && <><span className="dot" /><span>{med.kingdom}</span></>}
        </div>

        {med.short_description && <div className="detail-desc">{med.short_description}</div>}

        {(med.pack_size || med.pack_size_2) && (
          <>
            <div className="section-label">Pack size</div>
            <div className="pack-row">
              {med.pack_size && <span className="pack-box">{med.pack_size}</span>}
              {med.pack_size_2 && <span className="pack-box">{med.pack_size_2}</span>}
            </div>
          </>
        )}

        <div className="section-label">Potency</div>
        <div className="potency-grid">
          {potencyIds.map((p) => (
            <button
              key={p.id}
              className={
                'potency-box'
                + (selectedPotencyId === p.id ? ' active' : '')
                + (p.total === 0 ? ' empty' : '')
              }
              onClick={() => setSelectedPotencyId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>

        {selectedPotencyId != null && (
          cellsForSelected.length > 0 ? (
            <div className="qty-readout" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
              {cellsForSelected.map((s) => (
                <div key={s.pack_size_id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span className="lbl">
                    Available in <b>{s.potency}</b> ({s.pack_size}):
                  </span>
                  <span className="big">{s.quantity}</span>
                  <span className="lbl">units{s.min_level > 0 ? ` · min ${s.min_level}` : ''}</span>
                  {s.min_level > 0 && s.quantity < s.min_level && (
                    <span className="chip chip-low">Below minimum</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="qty-readout">
              <span className="lbl">No stock available for this potency.</span>
            </div>
          )
        )}
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="tabs">
          <button className="active">Indication / Benefits</button>
        </div>
        <div className="tab-body">
          {med.indications
            ? med.indications
            : 'No indication details have been added for this medicine yet. Add them from the Manage page.'}
        </div>
      </div>
    </div>
  );
}
