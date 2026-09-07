import { useState } from "react";

type Med = {
  id: number;
  name: string;
  common_name?: string;
  abbreviation?: string;
  score?: number;
  exact?: boolean;
};
type Ref = { id: number; name: string };
type Resp = {
  scan: { name: string; potency: string; confidence: number };
  medicine: Med | null;
  alternatives: Med[];
  matchedPotencyId: number | null;
  potencies: Ref[];
  packSizes: Ref[];
  defaultPackSizeId: number | null;
  currentQty: number | null;
};

async function resize(file: File, maxDim = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.85));
}

export default function MedicineScanner() {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [medId, setMedId] = useState<number | null>(null);
  const [potId, setPotId] = useState<number | null>(null);
  const [packId, setPackId] = useState<number | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    setData(null);
    try {
      const fd = new FormData();
      fd.append("image", await resize(file), "scan.jpg");
      const res = await fetch("/api/identify", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || "Scan failed");
      const d: Resp = await res.json();
      setData(d);
      setMedId(d.medicine?.id ?? d.alternatives[0]?.id ?? null);
      setPotId(d.matchedPotencyId ?? null);
      setPackId(d.defaultPackSizeId ?? null);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function addOne() {
    if (!medId || !potId || !packId) {
      setMsg("Pick medicine, potency and pack size first");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/stock/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          medicine_id: medId,
          potency_id: potId,
          pack_size_id: packId,
          quantity: 1,
        }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Could not update stock");
      const row = await res.json();
      const medName =
        data?.alternatives.find((m) => m.id === medId)?.name ?? "Medicine";
      const potName = data?.potencies.find((p) => p.id === potId)?.name ?? "";
      setMsg(`✓ ${medName} ${potName} — now ${row.quantity} in stock`);
      setData(null);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isDefault =
    !!data &&
    medId === data.medicine?.id &&
    potId === data.matchedPotencyId &&
    packId === data.defaultPackSizeId;

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 440 }}>
      <label
        style={{
          padding: 14,
          border: "1px solid #ccc",
          borderRadius: 8,
          textAlign: "center",
          cursor: "pointer",
        }}
      >
        📷 Scan medicine
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          style={{ display: "none" }}
        />
      </label>

      {busy && <p>Working…</p>}
      {msg && <p>{msg}</p>}

      {data && (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 12,
            display: "grid",
            gap: 8,
          }}
        >
          <p style={{ margin: 0, color: "#666" }}>
            Read: <b>{data.scan.name || "—"}</b> {data.scan.potency}
            {data.scan.confidence < 0.6 &&
              data.scan.name &&
              " · low confidence, check below"}
          </p>

          {data.alternatives.length === 0 ? (
            <p style={{ color: "crimson" }}>
              No matching medicine in your catalog.
            </p>
          ) : (
            <label>
              Medicine
              <select
                value={medId ?? ""}
                onChange={(e) => setMedId(Number(e.target.value))}
              >
                {data.alternatives.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Potency
            <select
              value={potId ?? ""}
              onChange={(e) => setPotId(Number(e.target.value))}
            >
              <option value="" disabled>
                Select…
              </option>
              {data.potencies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Pack size
            <select
              value={packId ?? ""}
              onChange={(e) => setPackId(Number(e.target.value))}
            >
              <option value="" disabled>
                Select…
              </option>
              {data.packSizes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {isDefault && data.currentQty !== null && (
            <p style={{ margin: 0, color: "#666" }}>
              Currently {data.currentQty} in stock
            </p>
          )}

          <button disabled={busy} onClick={addOne}>
            Confirm — add 1
          </button>
        </div>
      )}
    </div>
  );
}
