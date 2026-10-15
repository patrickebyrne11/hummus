"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SUPPLIERS } from "@/lib/catalog";
import type { InventoryItem, ItemDeal } from "@/lib/schemas";
import { qty, usd, usdPrecise } from "@/lib/format";

type Step = "input" | "confirm" | "deals";
type Busy = null | "parse" | "deals" | "checkout";
type Selection = Record<number, { included: boolean; sku: string | null }>;

const STORAGE_KEY = "stockwise:v1";

const SAMPLE = `Espresso beans – 18 kg, we pay $24/kg from BeanCo
Oat milk (barista) – 40 L at $3.10/L
Whole milk 120 litres
12oz compostable hot cups: 4 cases of 1000, paying $85/case
Hot lids x 4000
Vanilla syrup – 6 bottles (750 ml)
Chai concentrate 10 L
Frozen croissants, 180 for the week
Napkins – 1 case
Espresso machine cleaning powder`;

const STEPS: { id: Step | "pay"; label: string }[] = [
  { id: "input", label: "Your stock" },
  { id: "confirm", label: "Check the list" },
  { id: "deals", label: "Review deals" },
  { id: "pay", label: "Approve & pay" },
];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function Stockwise() {
  const [step, setStep] = useState<Step>("input");
  const [mode, setMode] = useState<"type" | "upload">("type");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [deals, setDeals] = useState<ItemDeal[]>([]);
  const [summary, setSummary] = useState("");
  const [selection, setSelection] = useState<Selection>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const restored = useRef(false);

  // Restore after a cancelled Stripe checkout so Bob doesn't lose his review.
  // sessionStorage only exists after hydration, so this has to run in an effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const s = JSON.parse(saved);
        setStep(s.step);
        setItems(s.items);
        setSkipped(s.skipped);
        setDeals(s.deals);
        setSummary(s.summary);
        setSelection(s.selection);
      }
      setCancelled(new URLSearchParams(window.location.search).has("cancelled"));
    } catch {}
    restored.current = true;
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ step, items, skipped, deals, summary, selection }),
      );
    } catch {}
  }, [step, items, skipped, deals, summary, selection]);

  async function readList() {
    setError(null);
    setBusy("parse");
    try {
      const form = new FormData();
      if (mode === "upload" && file) form.set("file", file);
      else form.set("text", text);
      const res = await fetch("/api/parse", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't read that list.");
      setItems(data.items);
      setSkipped(data.skipped);
      setStep("confirm");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function findDeals() {
    setError(null);
    setBusy("deals");
    try {
      const data = await postJson<{ deals: ItemDeal[]; summary: string }>("/api/deals", { items });
      setDeals(data.deals);
      setSummary(data.summary);
      setSelection(
        Object.fromEntries(
          data.deals.map((d, i) => [i, { included: d.recommendedSku !== null, sku: d.recommendedSku }]),
        ),
      );
      setStep("deals");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const chosen = useMemo(
    () =>
      deals.flatMap((d, i) => {
        const sel = selection[i];
        const opt = sel?.included ? d.options.find((o) => o.sku === sel.sku) : undefined;
        return opt ? [{ deal: d, opt }] : [];
      }),
    [deals, selection],
  );

  const totals = useMemo(() => {
    const newSpend = chosen.reduce((s, c) => s + c.opt.total, 0);
    const comparable = chosen.filter((c) => c.deal.currentCost != null);
    const before = comparable.reduce((s, c) => s + (c.deal.currentCost ?? 0), 0);
    const after = comparable.reduce((s, c) => s + c.opt.total, 0);
    const bySupplier = new Map<string, number>();
    for (const c of chosen) bySupplier.set(c.opt.supplierId, (bySupplier.get(c.opt.supplierId) ?? 0) + c.opt.total);
    const underMinimum = SUPPLIERS.filter(
      (s) => bySupplier.has(s.id) && bySupplier.get(s.id)! < s.minOrderUsd,
    ).map((s) => ({ ...s, subtotal: bySupplier.get(s.id)! }));
    return { newSpend, savings: before - after, comparableCount: comparable.length, bySupplier, underMinimum };
  }, [chosen]);

  async function approveAndPay() {
    setError(null);
    setBusy("checkout");
    try {
      const { url } = await postJson<{ url: string }>("/api/checkout", {
        lines: chosen.map((c) => ({ sku: c.opt.sku, packs: c.opt.packs })),
      });
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  function startOver() {
    setStep("input");
    setItems([]);
    setDeals([]);
    setSelection({});
    setSummary("");
    setError(null);
    setCancelled(false);
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="flex-1">
      <header className="border-b border-line bg-surface/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-full bg-accent text-sm font-semibold text-surface">S</span>
            <span className="font-display text-xl font-semibold tracking-tight">Stockwise</span>
          </div>
          <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">
            Prototype · Stripe test mode
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-40 pt-8 sm:px-6">
        <ol className="mb-8 grid grid-cols-4 gap-2">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex flex-col gap-2">
              <span className={`h-1 rounded-full ${i <= stepIndex ? "bg-accent" : "bg-line"}`} />
              <span className={`text-xs sm:text-sm ${i === stepIndex ? "font-medium text-foreground" : "text-muted"}`}>
                <span className="tabular mr-1 hidden sm:inline">{i + 1}.</span>
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {cancelled && step === "deals" && (
          <Banner tone="warn">Payment was cancelled. Nothing was bought, and your deals are still here.</Banner>
        )}
        {error && <Banner tone="warn">{error}</Banner>}

        {step === "input" && (
          <section>
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              What do you need to restock, Bob?
            </h1>
            <p className="mt-2 max-w-2xl text-muted">
              Type your list however you like, or upload your inventory spreadsheet. The agent will
              work out what to buy and then search the suppliers for the best deals.
            </p>

            <div className="mt-6 inline-flex rounded-lg border border-line bg-surface p-1">
              {(["type", "upload"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-4 py-2 text-sm transition ${
                    mode === m ? "bg-accent text-surface" : "text-muted hover:text-foreground"
                  }`}
                >
                  {m === "type" ? "Type it in" : "Upload spreadsheet"}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
              {mode === "type" ? (
                <>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={11}
                    placeholder={"e.g.\nEspresso beans 18 kg, paying $24/kg\nOat milk barista 40 L\n12oz hot cups – 4 cases"}
                    className="w-full resize-y rounded-lg border border-line bg-background p-3 font-mono text-sm outline-none focus:border-accent"
                  />
                  <button onClick={() => setText(SAMPLE)} className="mt-2 text-sm text-accent underline-offset-4 hover:underline">
                    Fill in a sample café list
                  </button>
                </>
              ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line bg-background px-4 py-12 text-center hover:border-accent">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.ods"
                    className="sr-only"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <span className="font-medium">{file ? file.name : "Choose an Excel or CSV file"}</span>
                  <span className="text-sm text-muted">
                    {file ? `${(file.size / 1024).toFixed(1)} KB · click to change` : ".xlsx, .xls, .csv, or .ods up to 5 MB, in any column layout"}
                  </span>
                  <a href="/sample-inventory.xlsx" onClick={(e) => e.stopPropagation()} className="mt-2 text-sm text-accent underline-offset-4 hover:underline">
                    Download a sample spreadsheet
                  </a>
                </label>
              )}
            </div>

            <div className="mt-5">
              <PrimaryButton
                onClick={readList}
                disabled={busy !== null || (mode === "type" ? !text.trim() : !file)}
                loading={busy === "parse"}
                loadingLabel="Reading your list…"
              >
                Read my list
              </PrimaryButton>
            </div>
          </section>
        )}

        {step === "confirm" && (
          <section>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Here&apos;s what I understood</h1>
            <p className="mt-2 text-muted">Check the quantities before I go shopping. You can edit or remove anything.</p>

            <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-background/60 text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">To buy</th>
                    <th className="hidden px-4 py-3 font-medium sm:table-cell">You pay now</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-b border-line last:border-0 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{it.name}</div>
                        {it.assumption && <div className="mt-0.5 text-xs text-warn">Assumed: {it.assumption}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={it.quantity}
                            onChange={(e) =>
                              setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))
                            }
                            className="tabular w-20 rounded-md border border-line bg-background px-2 py-1 outline-none focus:border-accent"
                          />
                          <span className="text-muted">{it.unit === "unit" ? "units" : it.unit}</span>
                        </div>
                      </td>
                      <td className="tabular hidden px-4 py-3 text-muted sm:table-cell">
                        {it.currentUnitPrice != null ? `${usdPrecise(it.currentUnitPrice)} / ${it.unit}` : "—"}
                      </td>
                      <td className="px-2 py-3">
                        <button
                          aria-label={`Remove ${it.name}`}
                          onClick={() => setItems(items.filter((_, j) => j !== i))}
                          className="rounded p-1 text-muted hover:bg-background hover:text-foreground"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {skipped.length > 0 && (
              <details className="mt-3 text-sm text-muted">
                <summary className="cursor-pointer">Skipped {skipped.length} line{skipped.length > 1 ? "s" : ""} that aren&apos;t stock</summary>
                <ul className="mt-2 list-disc pl-5">{skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </details>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <PrimaryButton
                onClick={findDeals}
                disabled={busy !== null || items.filter((i) => i.quantity > 0).length === 0}
                loading={busy === "deals"}
                loadingLabel="Comparing suppliers…"
              >
                Find me the best deals
              </PrimaryButton>
              <button onClick={startOver} className="px-3 py-2 text-sm text-muted hover:text-foreground">
                Start over
              </button>
            </div>
          </section>
        )}

        {step === "deals" && (
          <section>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Your best deals</h1>
            {summary && (
              <p className="mt-3 max-w-3xl rounded-xl border border-line bg-accent-soft/60 p-4 leading-relaxed">
                <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-accent">Agent</span>
                {summary}
              </p>
            )}

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Order total" value={usd(totals.newSpend)} />
              <Stat
                label={`Savings vs. today${totals.comparableCount ? ` (${totals.comparableCount} priced items)` : ""}`}
                value={totals.comparableCount ? usd(totals.savings) : "—"}
                tone={totals.savings > 0 ? "good" : undefined}
              />
              <Stat label="Suppliers" value={String(totals.bySupplier.size)} className="col-span-2 sm:col-span-1" />
            </div>

            {totals.underMinimum.length > 0 && (
              <div className="mt-4">
                {totals.underMinimum.map((s) => (
                  <Banner key={s.id} tone="warn">
                    {s.name} has a {usd(s.minOrderUsd)} minimum order, and this order only comes to {usd(s.subtotal)} with them. Pick a
                    different option or add items to reach the minimum.
                  </Banner>
                ))}
              </div>
            )}

            <div className="mt-6 space-y-4">
              {deals.map((d, i) => {
                const sel = selection[i] ?? { included: false, sku: null };
                const setSel = (patch: Partial<typeof sel>) => setSelection({ ...selection, [i]: { ...sel, ...patch } });
                return (
                  <article key={i} className={`rounded-xl border bg-surface transition ${sel.included ? "border-line" : "border-line opacity-60"}`}>
                    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                      <div>
                        <h2 className="font-medium">{d.item.name}</h2>
                        <p className="text-sm text-muted">
                          Need {qty(d.item.quantity, d.item.unit)}
                          {d.currentCost != null && <> · about {usd(d.currentCost)} at today&apos;s price</>}
                        </p>
                      </div>
                      {d.options.length > 0 && (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={sel.included}
                            onChange={(e) => setSel({ included: e.target.checked })}
                            className="size-4 accent-[var(--accent)]"
                          />
                          Buy this
                        </label>
                      )}
                    </header>

                    {d.note && <p className="border-b border-line bg-warn-soft/50 px-4 py-2 text-sm text-warn sm:px-5">{d.note}</p>}

                    <div className="divide-y divide-line">
                      {d.options.map((o) => {
                        const active = sel.sku === o.sku;
                        const saving = d.currentCost != null ? d.currentCost - o.total : null;
                        return (
                          <label
                            key={o.sku}
                            className={`flex cursor-pointer gap-3 px-4 py-3 sm:px-5 ${active ? "bg-accent-soft/40" : "hover:bg-background/60"}`}
                          >
                            <input
                              type="radio"
                              name={`deal-${i}`}
                              checked={active}
                              onChange={() => setSel({ sku: o.sku, included: true })}
                              className="mt-1 size-4 accent-[var(--accent)]"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                <div className="font-medium">
                                  {o.productName}
                                  {o.sku === d.recommendedSku && (
                                    <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-surface">
                                      Best deal
                                    </span>
                                  )}
                                </div>
                                <div className="tabular text-right">
                                  <span className="font-semibold">{usd(o.total)}</span>
                                  {saving != null && (
                                    <span className={`ml-2 text-sm ${saving >= 0 ? "text-good" : "text-warn"}`}>
                                      {saving >= 0 ? `save ${usd(saving)}` : `+${usd(-saving)}`}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="tabular mt-0.5 text-sm text-muted">
                                {o.supplierName} · {o.packs} × {o.packLabel} · {usdPrecise(o.unitPrice)}/{d.item.unit} · delivered in {o.deliveryDays} day{o.deliveryDays > 1 ? "s" : ""} · ★ {o.rating}
                              </div>
                              <p className="mt-1 text-sm">{o.why}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>

            <button onClick={startOver} className="mt-6 text-sm text-muted hover:text-foreground">
              Start a new list
            </button>
          </section>
        )}
      </main>

      {step === "deals" && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <div className="text-sm">
              <div className="font-medium">
                {chosen.length} item{chosen.length === 1 ? "" : "s"} approved · <span className="tabular">{usd(totals.newSpend)}</span>
              </div>
              <div className="text-muted">You&apos;ll confirm payment on Stripe. It&apos;s in test mode, so no real money moves.</div>
            </div>
            <PrimaryButton
              onClick={approveAndPay}
              disabled={busy !== null || chosen.length === 0}
              loading={busy === "checkout"}
              loadingLabel="Opening checkout…"
            >
              Approve & buy
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

function PrimaryButton(props: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-medium text-surface shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.loading && <span className="size-4 animate-spin rounded-full border-2 border-surface/40 border-t-surface" />}
      {props.loading ? props.loadingLabel : props.children}
    </button>
  );
}

function Banner({ tone, children }: { tone: "warn"; children: React.ReactNode }) {
  return (
    <div role="status" className={`mb-3 rounded-lg border px-4 py-3 text-sm ${tone === "warn" ? "border-warn/30 bg-warn-soft text-warn" : ""}`}>
      {children}
    </div>
  );
}

function Stat({ label, value, tone, className = "" }: { label: string; value: string; tone?: "good"; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface p-4 ${className}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className={`tabular mt-1 font-display text-2xl font-semibold ${tone === "good" ? "text-good" : ""}`}>{value}</div>
    </div>
  );
}
