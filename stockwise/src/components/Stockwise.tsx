"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SUPPLIERS } from "@/lib/catalog";
import type { InventoryItem, ItemDeal } from "@/lib/schemas";
import { qty, usd, usdPrecise } from "@/lib/format";

type Step = "input" | "confirm" | "deals";
type Busy = null | "parse" | "deals" | "checkout";
type Selection = Record<number, { included: boolean; sku: string | null }>;

const STORAGE_KEY = "stockwise:v1";

const SAMPLE = `Espresso beans: 4 kg left, par 20 kg, $24/kg from BeanCo
Oat milk (barista): 8 L left, par 48 L, $3.10/L
Whole milk: 18 L left, par 120 L
12oz compostable hot cups: 600 left, par 4000, $85 per case of 1000
Hot lids: 900 left, par 4000
Vanilla syrup: 1 bottle left (750 ml), par 6
Chai concentrate: out
Frozen croissants: 20 left, par 200
Napkins: 1 case
Espresso machine cleaning powder`;

// Pre-set budget buckets the owner has already set aside. Placeholder data until this is wired to real accounts.
const BUCKETS = [
  { id: "weekly", name: "Weekly restock", left: 600, total: 800 },
  { id: "dairy", name: "Dairy & bakery", left: 320, total: 400 },
  { id: "events", name: "Events & catering", left: 1500, total: 2000 },
  { id: "buffer", name: "Rainy day", left: 2000, total: 2500 },
];

const STEPS: { id: Step | "pay"; label: string }[] = [
  { id: "input", label: "Stock" },
  { id: "confirm", label: "Check list" },
  { id: "deals", label: "Deals" },
  { id: "pay", label: "Pay" },
];

const SCAN_LINES = [
  "Squinting at your spreadsheet…",
  "Counting beans, one by one…",
  "Deciphering Bob's handwriting…",
  "Politely ignoring the coffee stains…",
  "Alphabetising the oat milk…",
];

const PARSE_LINES = [
  "Teaching the robot to read…",
  "Translating \"lots\" into litres…",
  "Hunting for hidden croissants…",
  "Reading between the lines…",
];

const DEAL_LINES = [
  "Waking up the suppliers…",
  "Sniffing out bargains…",
  "Haggling with a very stubborn pallet…",
  "Comparing oat milks, one sip at a time…",
  "Bribing the delivery driver with biscuits…",
  "Checking who's secretly overcharging…",
  "Doing maths on the back of a napkin…",
  "Almost there. Putting a bow on it…",
];

// Eases toward `cap` while `active`, so the bar feels alive without lying about completion.
function useFakeProgress(active: boolean, ms: number, cap: number) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const t = setInterval(() => {
      const x = Math.min((Date.now() - start) / ms, 1);
      setP(Math.round(cap * (1 - Math.pow(1 - x, 2))));
    }, 100);
    return () => {
      clearInterval(t);
      setP(0);
    };
  }, [active, ms, cap]);
  return p;
}

// A bowl of hummus with a pita chip that dips in and out.
function HummusBowl() {
  return (
    <svg viewBox="0 0 120 84" className="h-20 w-auto overflow-visible" aria-hidden>
      <g className="hummus-bowl">
        <path d="M12 44 C12 70 30 78 60 78 C90 78 108 70 108 44 Z" fill="#c9784a" />
        <path d="M20 58 C40 66 80 66 100 58" stroke="#a85f36" strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="60" cy="44" rx="48" ry="14" fill="#8f5a34" />
        <ellipse cx="60" cy="43" rx="43" ry="11.5" fill="#f0d9a0" />
        <path
          className="hummus-swirl"
          d="M24 43 C34 36 52 37 60 40 C68 43 86 42 96 40 M40 46 C50 49 70 49 80 46"
          stroke="#d9b877"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse className="hummus-oil" cx="60" cy="42" rx="12" ry="4.5" fill="#b9a63a" opacity="0.85" />
        <circle cx="40" cy="40" r="1.6" fill="#c0392b" />
        <circle cx="78" cy="45" r="1.6" fill="#c0392b" />
        <circle cx="52" cy="46" r="1.3" fill="#c0392b" />
        <circle cx="70" cy="38" r="1.3" fill="#c0392b" />
      </g>
      <circle className="hummus-pea" style={{ animationDelay: "0s" }} cx="33" cy="42" r="3.2" fill="#e2b866" />
      <circle className="hummus-pea" style={{ animationDelay: "0.35s" }} cx="87" cy="40" r="3.2" fill="#e2b866" />
      <circle className="hummus-pea" style={{ animationDelay: "0.7s" }} cx="60" cy="47" r="3.2" fill="#e2b866" />
      <g className="hummus-dip">
        <path d="M82 6 L104 26 L84 30 Z" fill="#f1c27d" stroke="#c98f3d" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="90" cy="19" r="1" fill="#c98f3d" />
        <circle cx="96" cy="24" r="1" fill="#c98f3d" />
        <circle cx="86" cy="25" r="1" fill="#c98f3d" />
      </g>
      <path className="hummus-spark" style={{ animationDelay: "0.2s" }} d="M16 18 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#ffc46b" />
      <path className="hummus-spark" style={{ animationDelay: "0.9s" }} d="M52 4 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z" fill="#c651ff" />
    </svg>
  );
}

function LoaderCard({ title, lines, progress }: { title: string; lines: string[]; progress: number }) {
  const idx = Math.min(lines.length - 1, Math.floor((progress / 100) * lines.length));
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 px-4 py-12 text-center">
      <HummusBowl />
      <div className="font-display text-lg font-semibold">{title}</div>
      <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${progress}%`, background: "var(--grad)" }}
        />
      </div>
      <div className="flex w-full max-w-md justify-between gap-4 text-sm text-muted">
        <span className="text-left">{lines[idx]}</span>
        <span className="tabular">{progress}%</span>
      </div>
    </div>
  );
}

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
  const [scanning, setScanning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scanProgress = useFakeProgress(scanning, 1800, 100);
  const parseProgress = useFakeProgress(busy === "parse", 6000, 92);
  const dealProgress = useFakeProgress(busy === "deals", 14000, 92);

  function pickFile(f: File | null) {
    setFile(f);
    if (!f) return;
    setScanning(true);
    setTimeout(() => setScanning(false), 1800);
  }
  const [aiMode, setAiMode] = useState<"ai" | "demo" | null>(null);
  const [budget, setBudget] = useState("");
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [noLimit, setNoLimit] = useState(false);
  const [dealsBudget, setDealsBudget] = useState<number | null>(null);
  const budgetNum = !noLimit && Number(budget) > 0 ? Number(budget) : null;

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
        setAiMode(s.aiMode ?? null);
        setBudget(s.budget ?? "");
        setNoLimit(s.noLimit ?? false);
        setDealsBudget(s.dealsBudget ?? null);
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
        JSON.stringify({ step, items, skipped, deals, summary, selection, aiMode, budget, noLimit, dealsBudget }),
      );
    } catch {}
  }, [hydrated, step, items, skipped, deals, summary, selection, aiMode, budget, noLimit, dealsBudget]);

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
      setAiMode(data.mode);
      setStep("confirm");
      window.scrollTo({ top: 0 });
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
      const data = await postJson<{ deals: ItemDeal[]; summary: string; mode: "ai" | "demo" }>("/api/deals", { items, budget: budgetNum });
      setAiMode(data.mode);
      setDeals(data.deals);
      setSummary(data.summary);
      setDealsBudget(budgetNum);
      setSelection(
        Object.fromEntries(
          data.deals.map((d, i) => [i, { included: d.recommendedSku !== null, sku: d.recommendedSku }]),
        ),
      );
      setStep("deals");
      window.scrollTo({ top: 0 });
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
    const overBudget = budgetNum != null ? Math.max(0, newSpend - budgetNum) : 0;
    return { newSpend, savings: before - after, comparableCount: comparable.length, bySupplier, underMinimum, overBudget };
  }, [chosen, budgetNum]);

  async function approveAndPay() {
    setError(null);
    setBusy("checkout");
    try {
      const { url } = await postJson<{ url: string }>("/api/checkout", {
        budget: budgetNum,
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
    setBudget("");
    setBucketId(null);
    setNoLimit(false);
    setError(null);
    setCancelled(false);
  }

  function goBack(to: Step) {
    setError(null);
    setCancelled(false);
    setStep(to);
    window.scrollTo({ top: 0 });
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="flex-1">
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="btn-primary grid size-9 place-items-center rounded-xl font-display text-sm font-bold">H</span>
          <span className="font-display text-lg font-semibold tracking-tight">Hummus</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/beancounter" className="text-xs text-muted hover:text-foreground">
            BeanCounter agent →
          </Link>
          <span className="flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs text-muted backdrop-blur">
            <span className={`size-1.5 rounded-full ${aiMode === "ai" ? "bg-good" : "bg-warn"}`} />
            {aiMode === "ai" ? "Live AI, Stripe test mode" : aiMode === "demo" ? "Demo mode, sample matching" : "Prototype"}
          </span>
        </div>
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
          <Banner>Payment cancelled. Nothing was bought.</Banner>
        )}
        {error && <Banner>{error}</Banner>}

        {step === "input" && (
          <section className="mx-auto max-w-3xl text-center">
            <div>
              <h1 className="mx-auto max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
                What&apos;s running low?
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-lg text-muted">Nothing is bought until you approve it.</p>
            </div>

            {busy === "parse" ? (
              <div className="mt-8 rounded-3xl border border-line bg-surface/80 backdrop-blur">
                <LoaderCard title="Reading your list" lines={PARSE_LINES} progress={parseProgress} />
              </div>
            ) : (
            <>
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
                  {m === "type" ? "Type" : "Upload sheet"}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-3xl border border-line bg-surface/80 p-2 text-left shadow-xl shadow-black/5 backdrop-blur">
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
                      Use sample list
                    </button>
                    <span className="tabular text-xs text-muted">{text.split("\n").filter((l) => l.trim()).length} lines</span>
                  </div>
                </>
              ) : (
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    pickFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-16 text-center transition hover:border-orchid/60 ${
                    dragging ? "border-orchid bg-orchid/10" : "border-foreground/15"
                  }`}
                >
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.ods"
                    className="sr-only"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                  />
                  {scanning ? (
                    <LoaderCard title="Opening your sheet" lines={SCAN_LINES} progress={scanProgress} />
                  ) : (
                    <>
                      <span className="font-display text-lg font-semibold">{file ? file.name : "Drop your stock sheet"}</span>
                      <span className="text-sm text-muted">
                        {file ? `${(file.size / 1024).toFixed(1)} KB · click to change` : "Excel, CSV or ODS"}
                      </span>
                      <a href="/sample-inventory.xlsx" onClick={(e) => e.stopPropagation()} className="mt-3 text-sm font-medium text-glacier underline-offset-4 hover:underline">
                        Sample sheet
                      </a>
                    </>
                  )}
                </label>
              )}
            </div>

            <fieldset className="mt-4 rounded-3xl border border-line bg-surface/80 p-4 text-left shadow-xl shadow-black/5 backdrop-blur sm:px-5">
              <legend className="sr-only">Budget for this order</legend>
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div>
                  <div className="font-display text-base font-semibold">Budget</div>
                  <p className="mt-0.5 text-sm text-muted">
                    {noLimit ? "Best value per item, whatever the total." : "I'll keep the order under this."}
                  </p>
                </div>
                <div className="inline-flex rounded-full border border-line bg-background/60 p-1 text-sm">
                  {([true, false] as const).map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      aria-pressed={noLimit === value}
                      onClick={() => setNoLimit(value)}
                      className={`rounded-full px-4 py-1.5 font-medium transition ${
                        noLimit === value ? "bg-foreground text-background" : "text-muted hover:text-foreground"
                      }`}
                    >
                      {value ? "No limit" : "Set budget"}
                    </button>
                  ))}
                </div>
              </div>
              {!noLimit && (
                <div className="mt-4 border-t border-line pt-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted">Spend from a bucket</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {BUCKETS.map((b) => {
                      const active = bucketId === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setBucketId(b.id);
                            setBudget(String(b.left));
                          }}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            active ? "border-orchid bg-orchid/10" : "border-line hover:border-foreground/25"
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold">{b.name}</span>
                            <span className="tabular font-display text-sm font-semibold">${b.left.toLocaleString("en-US")}</span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${(b.left / b.total) * 100}%`, background: "var(--grad)" }}
                            />
                          </div>
                          <div className="tabular mt-1.5 text-xs text-muted">of ${b.total.toLocaleString("en-US")} left</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <label htmlFor="budget" className="text-sm text-muted">Or enter an amount</label>
                    <div className="flex items-center rounded-xl border border-line bg-background/60 px-3 focus-within:border-orchid">
                      <span className="text-muted">$</span>
                      <input
                        id="budget"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        placeholder="1000"
                        value={budget}
                        onChange={(e) => {
                          setBucketId(null);
                          setBudget(e.target.value);
                        }}
                        className="tabular w-28 bg-transparent px-1.5 py-2 text-right outline-none focus-visible:!outline-none placeholder:text-muted/60"
                      />
                    </div>
                  </div>
                </div>
              )}
            </fieldset>

            <div className="mt-6">
              <PrimaryButton
                onClick={readList}
                disabled={busy !== null || scanning || (mode === "type" ? !text.trim() : !file)}
                loading={false}
                loadingLabel="Reading your list…"
              >
                Read list
              </PrimaryButton>
            </div>
            </>
            )}
          </section>
        )}

        {step === "confirm" && (
          <section>
            {busy === "deals" ? (
              <div className="rounded-3xl border border-line bg-surface/80 backdrop-blur">
                <LoaderCard title="Finding your best deals" lines={DEAL_LINES} progress={dealProgress} />
              </div>
            ) : (
            <>
            <BackButton onClick={() => goBack("input")}>Stock</BackButton>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Your list</h1>
            <p className="mt-3 text-muted">Check the amounts to buy. Edit or remove anything.</p>

            {(() => {
              const short = items.filter((it) => it.shortage === "out" || it.shortage === "severe");
              if (short.length === 0) return null;
              return (
                <div className="mt-6 rounded-3xl border border-[#d6335a]/25 bg-[#ff6b8a]/10 p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-lg font-semibold text-[#b8264c]">Running out</h2>
                    <span className="tabular text-sm text-[#b8264c]/80">{short.length} item{short.length === 1 ? "" : "s"}</span>
                  </div>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {short.map((it, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 rounded-2xl bg-surface/80 px-4 py-2.5 text-sm">
                        <span className="font-medium">{it.name}</span>
                        <span className="tabular text-muted">{stockLine(it)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            <ul className="mt-8 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface/80 backdrop-blur">
              {items.map((it, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{it.name}</span>
                      {it.shortage && <ShortageTag level={it.shortage} />}
                    </div>
                    <div className="tabular mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
                      {stockLine(it) && <span>{stockLine(it)}</span>}
                      {it.currentUnitPrice != null && <span>now {usdPrecise(it.currentUnitPrice)}/{it.unit}</span>}
                      {it.assumption && <span className="text-warn">{it.assumption}</span>}
                    </div>
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
                      className="grid size-8 place-items-center rounded-full text-muted transition hover:bg-foreground/5 hover:text-foreground"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {skipped.length > 0 && (
              <details className="mt-4 text-sm text-muted">
                <summary className="cursor-pointer">{skipped.length} line{skipped.length > 1 ? "s" : ""} skipped</summary>
                <ul className="mt-2 list-disc pl-5">{skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </details>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <PrimaryButton
                onClick={findDeals}
                disabled={busy !== null || items.filter((i) => i.quantity > 0).length === 0}
                loading={false}
                loadingLabel="Comparing suppliers…"
              >
                Find deals
              </PrimaryButton>
              <button onClick={startOver} className="px-4 py-2 text-sm text-muted hover:text-foreground">
                Start over
              </button>
            </div>
            </>
            )}
          </section>
        )}

        {step === "deals" && (
          <section>
            <BackButton onClick={() => goBack("confirm")}>Check list</BackButton>
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Deals</h1>
                {summary && <p className="tabular mt-3 line-clamp-2 max-w-2xl text-muted">{summary}</p>}
              </div>
              {totals.comparableCount > 0 && totals.savings > 0 && (
                <div className="gradient-border rounded-3xl px-6 py-5">
                  <div className="text-sm text-muted">You save</div>
                  <div className="tabular font-display text-4xl font-bold">{usd(totals.savings)}</div>
                  <div className="mt-1 text-xs text-muted">vs today, {totals.comparableCount} items</div>
                </div>
              )}
            </div>

            <BudgetMeter
              budget={budget}
              onBudgetChange={setBudget}
              noLimit={noLimit}
              onNoLimitChange={setNoLimit}
              budgetNum={budgetNum}
              spend={totals.newSpend}
              stale={budgetNum !== dealsBudget}
              onRefresh={findDeals}
              refreshing={busy === "deals"}
            />

            {totals.underMinimum.length > 0 && (
              <div className="mt-6">
                {totals.underMinimum.map((s) => (
                  <Banner key={s.id}>
                    {s.name} has a {usd(s.minOrderUsd)} minimum. You&apos;re at {usd(s.subtotal)}.
                  </Banner>
                ))}
              </div>
            )}

            <ul className="mt-8 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface/80 backdrop-blur">
              {deals.map((d, i) => {
                const sel = selection[i] ?? { included: false, sku: null };
                return (
                  <DealRow
                    key={i}
                    deal={d}
                    included={sel.included}
                    sku={sel.sku}
                    onChange={(patch) => setSelection({ ...selection, [i]: { ...sel, ...patch } })}
                  />
                );
              })}
            </ul>

            <button onClick={startOver} className="mt-8 text-sm text-muted hover:text-foreground">
              Start a new list
            </button>
          </section>
        )}
      </main>

      {step === "deals" && (
        <div className="fixed inset-x-0 bottom-4 px-4">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 rounded-3xl border border-line bg-surface-2/85 px-5 py-4 shadow-2xl shadow-black/10 backdrop-blur-xl">
            <div className="min-w-0">
              <div className="tabular font-display text-xl font-semibold">
                {usd(totals.newSpend)}
                {budgetNum != null && <span className="block whitespace-nowrap text-sm font-normal text-muted sm:ml-2 sm:inline">of {usd(budgetNum)}</span>}
              </div>
              {totals.overBudget > 0 ? (
                <div className="text-sm font-medium text-warn">
                  {usd(totals.overBudget)} over budget
                  <span className="hidden sm:inline">. Untick items, pick cheaper options or raise the budget.</span>
                </div>
              ) : (
                <div className="hidden text-sm text-muted sm:block">
                  {chosen.length} item{chosen.length === 1 ? "" : "s"} · {totals.bySupplier.size} supplier
                  {totals.bySupplier.size === 1 ? "" : "s"}
                </div>
              )}
            </div>
            <PrimaryButton
              onClick={approveAndPay}
              disabled={busy !== null || chosen.length === 0 || totals.overBudget > 0}
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

function stockLine(it: InventoryItem) {
  if (it.onHand == null) return it.shortage === "out" ? "none left" : "";
  const unit = it.unit === "unit" ? "" : ` ${it.unit}`;
  const left = `${qty(it.onHand, it.unit).replace(/ (units?|kg|L)$/, "")}${unit} left`;
  return it.par != null ? `${left} of ${qty(it.par, it.unit).replace(/ (units?|kg|L)$/, "")}${unit}` : left;
}

function ShortageTag({ level }: { level: NonNullable<InventoryItem["shortage"]> }) {
  const style = level === "low" ? "bg-warn/15 text-warn" : "bg-[#ff6b8a]/15 text-[#b8264c]";
  const label = level === "out" ? "Out" : level === "severe" ? "Very low" : "Low";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>{label}</span>;
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
      className="btn-primary inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-5 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-40 sm:px-6"
    >
      {props.loading && <span className="size-4 animate-spin rounded-full border-2 border-black/20 border-t-black/70" />}
      {props.loading ? props.loadingLabel : props.children}
    </button>
  );
}

function DealRow({
  deal: d,
  included,
  sku,
  onChange,
}: {
  deal: ItemDeal;
  included: boolean;
  sku: string | null;
  onChange: (patch: { included?: boolean; sku?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = d.options.find((o) => o.sku === sku) ?? null;
  const saving = pick && d.currentCost != null ? d.currentCost - pick.total : null;
  const budgetSwap = d.note?.includes("budget") ?? false;

  return (
    <li className={included ? "" : "bg-foreground/[0.02]"}>
      <div className="flex items-center gap-4 px-5 py-4">
        <input
          type="checkbox"
          checked={included}
          disabled={!d.options.length}
          onChange={(e) => onChange({ included: e.target.checked })}
          aria-label={`Buy ${d.item.name}`}
          className="size-5 shrink-0 accent-[var(--orchid)]"
        />
        <div className={`grid min-w-0 flex-1 gap-x-6 gap-y-1 sm:grid-cols-[1fr_1.4fr_7rem] sm:items-center ${included ? "" : "opacity-50"}`}>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold">{d.item.name}</span>
              {d.item.shortage && <ShortageTag level={d.item.shortage} />}
            </div>
            <div className="tabular text-sm text-muted">{qty(d.item.quantity, d.item.unit)}</div>
          </div>
          {pick ? (
            <div className="min-w-0 text-sm">
              <div className="truncate">{pick.productName}</div>
              <div className="truncate text-muted">
                {pick.supplierName}, {pick.deliveryDays === 1 ? "arrives tomorrow" : `arrives in ${pick.deliveryDays} days`}
              </div>
              {budgetSwap && <div className="text-warn">Cheaper pick to fit your budget</div>}
            </div>
          ) : (
            <div className="text-sm text-muted">{d.note ?? "No match found"}</div>
          )}
          {pick && (
            <div className="tabular sm:text-right">
              <div className="font-display font-semibold">{usd(pick.total)}</div>
              {saving != null && (
                <div className={`text-sm ${saving >= 0 ? "text-good" : "text-warn"}`}>
                  {saving >= 0 ? `Save ${usd(saving)}` : `${usd(-saving)} more`}
                </div>
              )}
            </div>
          )}
        </div>
        {d.options.length > 1 ? (
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex w-9 shrink-0 items-center justify-end gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm text-muted sm:w-[7.5rem] transition hover:bg-foreground/5 hover:text-foreground"
          >
            <span className="hidden sm:inline">{open ? "Hide" : `${d.options.length} options`}</span>
            <svg viewBox="0 0 20 20" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m5 7.5 5 5 5-5" />
            </svg>
            <span className="sr-only sm:hidden">Compare options</span>
          </button>
        ) : (
          <span className="w-9 shrink-0 sm:w-[7.5rem]" aria-hidden />
        )}
      </div>

      {open && (
        <div className="space-y-1 px-5 pb-4 sm:pl-14">
          {d.options.map((o) => {
            const active = o.sku === sku;
            const diff = d.currentCost != null ? d.currentCost - o.total : null;
            return (
              <label
                key={o.sku}
                className={`flex cursor-pointer gap-3 rounded-2xl px-4 py-3 text-sm transition ${
                  active ? "gradient-border" : "border border-transparent hover:bg-foreground/[0.03]"
                }`}
              >
                <input
                  type="radio"
                  checked={active}
                  onChange={() => onChange({ sku: o.sku, included: true })}
                  className="mt-0.5 size-4 accent-[var(--orchid)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-x-4">
                    <span className="font-medium">{o.productName}</span>
                    <span className="tabular">
                      <span className="font-semibold">{usd(o.total)}</span>
                      {diff != null && (
                        <span className={`ml-2 ${diff >= 0 ? "text-good" : "text-warn"}`}>
                          {diff >= 0 ? `save ${usd(diff)}` : `${usd(-diff)} more`}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="tabular text-muted">
                    {o.supplierName}, {o.packs} × {o.packLabel}, {usdPrecise(o.unitPrice)} per {d.item.unit}
                  </div>
                  <p className="mt-1">{o.why}</p>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </li>
  );
}

function BackButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="-ml-2 mb-4 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium text-muted transition hover:bg-foreground/5 hover:text-foreground"
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12.5 15 7.5 10l5-5" />
      </svg>
      <span>
        <span className="sr-only">Back to </span>
        {children}
      </span>
    </button>
  );
}

function BudgetMeter(props: {
  budget: string;
  onBudgetChange: (v: string) => void;
  noLimit: boolean;
  onNoLimitChange: (v: boolean) => void;
  budgetNum: number | null;
  spend: number;
  stale: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { budgetNum, spend } = props;
  const over = budgetNum != null && spend > budgetNum + 0.005;
  const pct = budgetNum ? Math.min(100, (spend / budgetNum) * 100) : 0;
  return (
    <div className="mt-6 rounded-2xl border border-line bg-surface/80 px-5 py-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          {budgetNum == null ? (
            <span className="text-muted">No budget limit on this order.</span>
          ) : over ? (
            <span className="font-medium text-warn">{usd(spend - budgetNum)} over your budget</span>
          ) : (
            <span>
              <span className="tabular font-semibold">{usd(budgetNum - spend)}</span>{" "}
              <span className="text-muted">left in your budget</span>
            </span>
          )}
        </div>
        {props.noLimit ? (
          <button
            onClick={() => props.onNoLimitChange(false)}
            className="text-sm font-medium text-glacier underline-offset-4 hover:underline"
          >
            Set a budget
          </button>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted">
            <label className="flex items-center gap-2">
              Budget
              <span className="flex items-center rounded-xl border border-line bg-background/60 px-3 focus-within:border-orchid">
                <span>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  placeholder="e.g. 1000"
                  value={props.budget}
                  onChange={(e) => props.onBudgetChange(e.target.value)}
                  className="tabular w-24 bg-transparent px-1.5 py-1.5 text-right text-foreground outline-none placeholder:text-muted/60"
                />
              </span>
            </label>
            <button
              onClick={() => props.onNoLimitChange(true)}
              className="rounded-full px-2 py-1 font-medium transition hover:bg-foreground/5 hover:text-foreground"
            >
              No limit
            </button>
          </div>
        )}
      </div>
      {props.stale && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-foreground/[0.04] px-3 py-2 text-sm">
          <span className="text-muted">These deals were picked for {props.budgetNum == null ? "a different budget" : "your old budget"}.</span>
          <button
            onClick={props.onRefresh}
            disabled={props.refreshing}
            className="font-medium text-glacier underline-offset-4 hover:underline disabled:opacity-50"
          >
            {props.refreshing ? "Finding deals…" : "Find deals for this budget"}
          </button>
        </div>
      )}
      {budgetNum != null && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={budgetNum} aria-valuenow={spend} aria-label="Budget used">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${pct}%`, background: over ? "var(--warn)" : "var(--grad)" }}
          />
        </div>
      )}
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="mb-4 rounded-2xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn">
      {children}
    </div>
  );
}
