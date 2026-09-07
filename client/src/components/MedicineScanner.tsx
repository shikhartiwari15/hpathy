import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { IdentifyResponse } from '../types';
import Modal from './Modal';
import Icon from './Icon';

// Capture straight from the live video stream at a capped resolution, rather than
// handing off to the OS camera app. Requesting a modest ideal resolution up front means
// we never decode a huge full-res bitmap in the first place — the browser negotiates a
// smaller stream directly with the camera. This sidesteps the Android "low memory" intent
// failure entirely (that bug happens when a full-res photo is handed back through the OS
// camera app, before it ever reaches the page).
const CAPTURE_DIM = 1280;

async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
      width: { ideal: CAPTURE_DIM },
      height: { ideal: CAPTURE_DIM },
    },
    audio: false,
  });
}

function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const s = Math.min(1, CAPTURE_DIM / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * s);
  c.height = Math.round(video.videoHeight * s);
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85));
}

export default function ScanMedicineModal({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: (label: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<IdentifyResponse | null>(null);
  const [medId, setMedId] = useState<number | null>(null);
  const [potId, setPotId] = useState<number | null>(null);
  const [packId, setPackId] = useState<number | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Camera opens as soon as the modal mounts, and stays open (video keeps running
  // in the background) through the scan/result step, so "Rescan" can reuse it instantly
  // without asking for camera permission again.
  useEffect(() => {
    let cancelled = false;
    openCamera()
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCamReady(true);
      })
      .catch((err: unknown) => setCamError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access for this site and try again.'
          : 'Could not open the camera on this device.'
      ));
    return () => { cancelled = true; stopCamera(); };
  }, []);

  const reset = () => { setData(null); setError(null); };

  async function onCapture() {
    if (!videoRef.current || !camReady) return;
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const img = await captureFrame(videoRef.current);
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
            Point the camera at the medicine's label — the name and potency are read
            automatically and matched against your catalog.
          </p>

          {camError ? (
            <p style={{ color: 'var(--danger)', fontSize: 13.5, margin: 0 }}>{camError}</p>
          ) : (
            <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
              <video
                ref={(el) => {
                  videoRef.current = el;
                  // The result screen unmounts this <video>; when Rescan brings it back,
                  // reattach the still-running stream instead of waiting on the mount effect.
                  if (el && streamRef.current && el.srcObject !== streamRef.current) {
                    el.srcObject = streamRef.current;
                  }
                }}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', display: 'block', aspectRatio: '1 / 1', objectFit: 'cover' }}
              />
              {!camReady && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: 'var(--ink)',
                }}>
                  <span className="spinner" />
                </div>
              )}
            </div>
          )}

          <button className="btn btn-primary" disabled={busy || !camReady || !!camError} onClick={onCapture}
            style={{ width: '100%' }}>
            {busy ? <><span className="spinner" /> Reading label…</> : <><Icon name="camera" size={16} /> Capture</>}
          </button>
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
