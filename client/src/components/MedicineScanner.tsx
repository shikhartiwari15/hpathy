import { useRef, useState } from 'react';
import { api } from '../api';
import type { IdentifyResponse } from '../types';
import Modal from './Modal';
import Icon from './Icon';

// Downscale client-side before upload — keeps the request small and fast on mobile data.
// Phone camera photos are often 12MP+; decoding one at full resolution before shrinking it
// can allocate 40-50MB+ for the raw bitmap alone, which crashes the tab on lower-RAM phones
// (shows up as a blank page). Passing resizeWidth tells the browser to decode straight to a
// small bitmap instead, so peak memory stays low regardless of the source photo's size.
async function resize(file: File, maxDim = 1280): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeWidth: maxDim,
      resizeQuality: 'medium',
    });
  } catch {
    // Older browsers that don't support resize options — fall back to a full decode.
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close(); // release the decoded bitmap immediately rather than waiting on GC
  return new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85));
}

export default function ScanMedicineModal({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: (label: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<IdentifyResponse | null>(null);
  const [medId, setMedId] = useState<number | null>(null);
  const [potId, setPotId] = useState<number | null>(null);
  const [packId, setPackId] = useState<number | null>(null);

  const reset = () => { setData(null); setError(null); };

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const img = await resize(file);
      const d = await api.identifyMedicine(img);
      setData(d);
      setMedId(d.medicine?.id ?? d.alternatives[0]?.id ?? null);
      setPotId(d.matchedPotencyId ?? null);
      setPackId(d.defaultPackSizeId ?? null);
      if (!d.scan.name) setError('Could not read a homeopathy label in that photo — try again with better light.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!medId || !potId || !packId) { setError('Pick medicine, potency and pack size first'); return; }
    setBusy(true);
    setError(null);
    try {
      const row: any = await api.addStock(medId, potId, 1, packId);
      const medName = data?.alternatives.find((m) => m.id === medId)?.name ?? 'Medicine';
      const potName = data?.potencies.find((p) => p.id === potId)?.name ?? '';
      onAdded(`${medName} ${potName} — now ${row.quantity} in stock`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Scan medicine"
      onClose={onClose}
      footer={
        data && data.alternatives.length > 0 ? (
          <>
            <button className="btn btn-ghost" onClick={reset}>Rescan</button>
            <button className="btn btn-primary" disabled={busy || !medId || !potId || !packId} onClick={confirm}>
              {busy ? <><span className="spinner" /> Adding…</> : 'Confirm — add 1'}
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        )
      }
    >
      {!data && (
        <>
          <p className="muted" style={{ fontSize: 13.5, marginTop: -4 }}>
            Photograph the medicine's label — the name and potency are read automatically
            and matched against your catalog.
          </p>
          <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}
            style={{ width: '100%' }}>
            {busy ? <><span className="spinner" /> Reading label…</> : <><Icon name="camera" size={16} /> Take or choose a photo</>}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        </>
      )}

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 13.5, margin: 0 }}>{error}</p>
      )}

      {data && (
        <div style={{ display: 'grid', gap: 14 }}>
          <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
            Read: <b style={{ color: 'var(--ink)' }}>{data.scan.name || '—'}</b> {data.scan.potency}
            {data.scan.confidence < 0.6 && data.scan.name && (
              <span className="chip chip-low" style={{ marginLeft: 8 }}>Low confidence — check below</span>
            )}
          </p>

          {data.alternatives.length === 0 ? (
            <p style={{ color: 'var(--danger)', fontSize: 13.5, margin: 0 }}>
              No matching medicine in your catalog. Add it under <b>Manage</b> first, then rescan.
            </p>
          ) : (
            <>
              <div className="field">
                <label>Medicine</label>
                <select className="select" value={medId ?? ''} onChange={(e) => setMedId(Number(e.target.value))}>
                  {data.alternatives.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}{m.exact ? '' : ' (closest match)'}</option>
                  ))}
                </select>
              </div>

              <div className="form-grid">
                <div className="field">
                  <label>Potency</label>
                  <select className="select" value={potId ?? ''} onChange={(e) => setPotId(Number(e.target.value))}>
                    <option value="" disabled>Select…</option>
                    {data.potencies.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Pack size</label>
                  <select className="select" value={packId ?? ''} onChange={(e) => setPackId(Number(e.target.value))}>
                    <option value="" disabled>Select…</option>
                    {data.packSizes.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {medId === data.medicine?.id && potId === data.matchedPotencyId && packId === data.defaultPackSizeId
                && data.currentQty !== null && (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>Currently {data.currentQty} in stock</p>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
