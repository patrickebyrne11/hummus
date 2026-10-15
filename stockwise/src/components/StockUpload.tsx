"use client";

import { useState } from "react";

type Update = { item_id: string; on_hand: number; source_row: string; assumption: string | null };
type Result = { updates: Update[]; unmatched: string[]; state: unknown };

// Drop a stock-count sheet in; Claude maps it onto the agent's stock and the table refreshes.
export function StockUpload<S>({ onState }: { onState: (s: S) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import-stock", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      setResult(data);
      onState(data.state as S);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        className={`flex cursor-pointer flex-col items-center rounded-2xl border border-dashed px-4 py-5 text-center transition ${
          dragging ? "border-orchid bg-orchid/10" : "border-line bg-background/40 hover:border-orchid"
        }`}
      >
        <input
          type="file"
          accept=".xlsx,.xls,.csv,.ods"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <span className="text-sm font-semibold">{busy ? "Reading your stock sheet…" : "Drop in your stock sheet"}</span>
        <span className="mt-1 text-xs text-muted">Excel or CSV. Updates the counts below.</span>
      </label>

      {error && <p className="mt-2 text-sm text-[#b8264c]">{error}</p>}
      {result && (
        <div className="mt-2 text-xs text-muted">
          Updated {result.updates.length} item{result.updates.length === 1 ? "" : "s"} from your sheet
          {result.updates.some((u) => u.assumption) &&
            `: ${result.updates.filter((u) => u.assumption).map((u) => u.assumption).join("; ")}`}
          {result.unmatched.length > 0 && <> · Not tracked: {result.unmatched.join(", ")}</>}
        </div>
      )}
    </div>
  );
}
