"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [hydrated, setHydrated] = useState(false);

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
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    // Gate on state, not a ref: under Strict Mode the effects run twice, and a ref
    // would let this overwrite storage before the second restore reads it.
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ step, items, skipped, deals, summary, selection }),
      );
    } catch {}
  }, [hydrated, step, items, skipped, deals, summary, selection]);

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
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="btn-primary grid size-9 place-items-center rounded-xl font-display text-sm font-bold">S</span>
          <span className="font-display text-lg font-semibold tracking-tight">Stockwise</span>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs text-muted backdrop-blur">
          <span className="size-1.5 rounded-full bg-warn" />
          Stripe test mode
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-44 pt-4 sm:px-6">
        <ol className="mb-10 grid grid-cols-4 gap-2" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex flex-col gap-2" aria-current={i === stepIndex ? "step" : undefined}>
              <span className="h-1 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full transition-[width] duration-500"
                  style={{ width: i <= stepIndex ? "100%" : "0%", background: "var(--grad)" }}
                />
              </span>
              <span className={`text-xs sm:text-sm ${i === stepIndex ? "font-semibold text-foreground" : "text-muted"}`}>
                <span className="tabular mr-1.5 hidden text-muted sm:inline">{i + 1}</span>
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {cancelled && step === "deals" && (
          <Banner>Payment was cancelled. Nothing was bought, and your deals are still here.</Banner>
        )}
        {error && <Banner>{error}</Banner>}

        {step === "input" && (
          <section>
            <div className="relative isolate -mx-4 px-4 pb-2 sm:-mx-6 sm:px-6">
              <div className="rings absolute inset-0 -z-10" aria-hidden />
              <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
                <span className="gradient-text">What are you running low on, Bob?</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
                Type your list however you like, or upload your stock sheet. I&apos;ll work out what to
                buy and find the best deals across your suppliers. Nothing is bought until you approve it.
              </p>
            </div>

            <div className="mt-8 inline-flex rounded-full border border-line bg-surface/70 p-1 backdrop-blur" role="tablist">
              {(["type", "upload"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                    mode === m ? "bg-foreground text-background" : "text-muted hover:text-foreground"
                  }`}
                >
                  {m === "type" ? "Type it in" : "Upload a spreadsheet"}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-3xl border border-line bg-surface/80 p-2 backdrop-blur">
              {mode === "type" ? (
                <>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={10}
                    aria-label="Your stock list"
                    placeholder={"Espresso beans 18 kg, paying $24/kg\nOat milk barista 40 L\n12oz hot cups, 4 cases"}
                    className="w-full resize-y rounded-2xl bg-transparent p-4 text-[15px] leading-relaxed outline-none placeholder:text-muted/60"
                  />
                  <div className="flex items-center justify-between border-t border-line px-4 py-3">
                    <button onClick={() => setText(SAMPLE)} className="text-sm font-medium text-glacier hover:underline underline-offset-4">
                      Try a sample café list
                    </button>
                    <span className="tabular text-xs text-muted">{text.split("\n").filter((l) => l.trim()).length} lines</span>
                  </div>
                </>
              ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-4 py-16 text-center transition hover:border-orchid/60">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.ods"
                    className="sr-only"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <span className="font-display text-lg font-semibold">{file ? file.name : "Drop in your stock sheet"}</span>
                  <span className="text-sm text-muted">
                    {file ? `${(file.size / 1024).toFixed(1)} KB, click to change` : "Excel, CSV or ODS up to 5 MB. Any column layout works."}
                  </span>
                  <a href="/sample-inventory.xlsx" onClick={(e) => e.stopPropagation()} className="mt-3 text-sm font-medium text-glacier underline-offset-4 hover:underline">
                    Download a sample sheet
                  </a>
                </label>
              )}
            </div>

            <div className="mt-6">
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
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Here&apos;s what I understood</h1>
            <p className="mt-3 text-muted">Check the quantities before I go shopping. You can edit or remove anything.</p>

            <ul className="mt-8 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface/80 backdrop-blur">
              {items.map((it, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="font-semibold">{it.name}</div>
                    {it.assumption && <div className="mt-1 text-sm text-warn">I assumed {lowerFirst(it.assumption)}</div>}
                    {it.currentUnitPrice != null && (
                      <div className="tabular mt-1 text-sm text-muted">You pay {usdPrecise(it.currentUnitPrice)} per {it.unit} today</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      aria-label={`Quantity of ${it.name}`}
                      value={it.quantity}
                      onChange={(e) =>
                        setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))
                      }
                      className="tabular w-24 rounded-xl border border-line bg-background/60 px-3 py-2 text-right outline-none focus:border-orchid"
                    />
                    <span className="w-10 text-sm text-muted">{it.unit === "unit" ? "units" : it.unit}</span>
                    <button
                      aria-label={`Remove ${it.name}`}
                      onClick={() => setItems(items.filter((_, j) => j !== i))}
                      className="grid size-8 place-items-center rounded-full text-muted transition hover:bg-white/5 hover:text-foreground"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {skipped.length > 0 && (
              <details className="mt-4 text-sm text-muted">
                <summary className="cursor-pointer">Skipped {skipped.length} line{skipped.length > 1 ? "s" : ""} that aren&apos;t stock</summary>
                <ul className="mt-2 list-disc pl-5">{skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </details>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <PrimaryButton
                onClick={findDeals}
                disabled={busy !== null || items.filter((i) => i.quantity > 0).length === 0}
                loading={busy === "deals"}
                loadingLabel="Comparing suppliers…"
              >
                Find me the best deals
              </PrimaryButton>
              <button onClick={startOver} className="px-4 py-2 text-sm text-muted hover:text-foreground">
                Start over
              </button>
            </div>
          </section>
        )}

        {step === "deals" && (
          <section>
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Your best deals</h1>
                {summary && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">{summary}</p>}
              </div>
              {totals.comparableCount > 0 && totals.savings > 0 && (
                <div className="gradient-border rounded-3xl px-6 py-5">
                  <div className="text-sm text-muted">You save</div>
                  <div className="tabular gradient-text font-display text-4xl font-bold">{usd(totals.savings)}</div>
                  <div className="mt-1 text-xs text-muted">compared with today&apos;s prices on {totals.comparableCount} items</div>
                </div>
              )}
            </div>

            {totals.underMinimum.length > 0 && (
              <div className="mt-6">
                {totals.underMinimum.map((s) => (
                  <Banner key={s.id}>
                    {s.name} needs a {usd(s.minOrderUsd)} minimum order, and this order only comes to {usd(s.subtotal)} with them. Pick
                    a different option or add more items from them.
                  </Banner>
                ))}
              </div>
            )}

            <div className="mt-8 space-y-5">
              {deals.map((d, i) => {
                const sel = selection[i] ?? { included: false, sku: null };
                const setSel = (patch: Partial<typeof sel>) => setSelection({ ...selection, [i]: { ...sel, ...patch } });
                return (
                  <article
                    key={i}
                    className={`rounded-3xl border border-line bg-surface/80 p-2 backdrop-blur transition-opacity ${sel.included ? "" : "opacity-50"}`}
                  >
                    <header className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-3">
                      <div>
                        <h2 className="font-display text-lg font-semibold">{d.item.name}</h2>
                        <p className="tabular text-sm text-muted">
                          Need {qty(d.item.quantity, d.item.unit)}
                          {d.currentCost != null && <>, about {usd(d.currentCost)} at today&apos;s price</>}
                        </p>
                      </div>
                      {d.options.length > 0 && (
                        <label className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={sel.included}
                            onChange={(e) => setSel({ included: e.target.checked })}
                            className="size-4 accent-[var(--orchid)]"
                          />
                          Buy this
                        </label>
                      )}
                    </header>

                    {d.note && <p className="mx-2 mb-2 rounded-2xl bg-warn/10 px-4 py-2.5 text-sm text-warn">{d.note}</p>}

                    <div className="space-y-1.5">
                      {d.options.map((o) => {
                        const active = sel.sku === o.sku;
                        const saving = d.currentCost != null ? d.currentCost - o.total : null;
                        return (
                          <label
                            key={o.sku}
                            className={`flex cursor-pointer gap-3 rounded-2xl px-4 py-3.5 transition ${
                              active ? "gradient-border" : "border border-transparent hover:bg-white/[0.03]"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`deal-${i}`}
                              checked={active}
                              onChange={() => setSel({ sku: o.sku, included: true })}
                              className="mt-1 size-4 accent-[var(--orchid)]"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                <div className="font-semibold">
                                  {o.productName}
                                  {o.sku === d.recommendedSku && (
                                    <span className="btn-primary ml-2 rounded-full px-2.5 py-0.5 align-middle text-xs font-bold">
                                      Best deal
                                    </span>
                                  )}
                                </div>
                                <div className="tabular text-right">
                                  <span className="font-display font-semibold">{usd(o.total)}</span>
                                  {saving != null && (
                                    <span className={`ml-2 text-sm font-medium ${saving >= 0 ? "text-good" : "text-warn"}`}>
                                      {saving >= 0 ? `save ${usd(saving)}` : `${usd(-saving)} more`}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="tabular mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted">
                                <span className="text-foreground/80">{o.supplierName}</span>
                                <span>{o.packs} × {o.packLabel}</span>
                                <span>{usdPrecise(o.unitPrice)} per {d.item.unit}</span>
                                <span>Arrives in {o.deliveryDays} day{o.deliveryDays > 1 ? "s" : ""}</span>
                                <span>★ {o.rating}</span>
                              </div>
                              <p className="mt-2 text-sm leading-relaxed">{o.why}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>

            <button onClick={startOver} className="mt-8 text-sm text-muted hover:text-foreground">
              Start a new list
            </button>
          </section>
        )}
      </main>

      {step === "deals" && (
        <div className="fixed inset-x-0 bottom-4 px-4">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 rounded-3xl border border-line bg-surface-2/85 px-5 py-4 shadow-2xl shadow-black/50 backdrop-blur-xl">
            <div>
              <div className="tabular font-display text-xl font-semibold">{usd(totals.newSpend)}</div>
              <div className="hidden text-sm text-muted sm:block">
                {chosen.length} item{chosen.length === 1 ? "" : "s"} from {totals.bySupplier.size} supplier
                {totals.bySupplier.size === 1 ? "" : "s"}. You&apos;ll confirm payment on Stripe.
              </div>
            </div>
            <PrimaryButton
              onClick={approveAndPay}
              disabled={busy !== null || chosen.length === 0}
              loading={busy === "checkout"}
              loadingLabel="Opening checkout…"
            >
              Approve and buy
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
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
      className="btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.loading && <span className="size-4 animate-spin rounded-full border-2 border-black/20 border-t-black/70" />}
      {props.loading ? props.loadingLabel : props.children}
    </button>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="mb-4 rounded-2xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn">
      {children}
    </div>
  );
}
