"use client";

import { useCallback, useEffect, useState } from "react";

// All decisions, the policy guard, Stripe and Cognee live in the Python API (api.py),
// proxied at /bc/* by next.config.ts. This component only renders state and sends clicks.

type StockItem = {
  id: string;
  name: string;
  qty: number;
  reorder_level: number;
  par: number;
  last_price: number;
  low: boolean;
};

type Skipped = { supplier: string; unit_price: number; clause: string; reason: string };

type Decision = {
  id: string;
  item: string;
  item_name: string;
  supplier: string | null;
  qty: number;
  unit_price: number;
  total: number;
  action: string;
  clause_ids: string[];
  reasoning: string;
  skipped_quotes?: Skipped[];
  payment_intent: string | null;
  approved_by: string | null;
  ts?: string;
};

type State = {
  stock: StockItem[];
  metrics: { spent_today: number; daily_cap: number; auto_limit: number };
  pending: Decision[];
  log: Decision[];
  policy: string[];
  dashboard_base: string;
};

type Why = { source: string; answer: string; evidence: string };

const gbp = (n: number) => n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });

const ACTIONS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  auto_buy: { label: "Auto-bought", tone: "good" },
  approved: { label: "Approved & paid", tone: "good" },
  needs_approval: { label: "Needs your approval", tone: "warn" },
  already_pending: { label: "Already awaiting approval", tone: "warn" },
  blocked: { label: "Blocked & escalated", tone: "bad" },
  rejected: { label: "Rejected by owner", tone: "muted" },
  no_action: { label: "No action needed", tone: "muted" },
};

const TONE: Record<string, string> = {
  good: "bg-good/15 text-good",
  warn: "bg-warn/15 text-warn",
  bad: "bg-[#ff6b8a]/15 text-[#ff8aa3]",
  muted: "bg-white/5 text-muted",
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/bc${path}`, {
    method: body === undefined && path === "/state" ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ?? `BeanCounter API error (${res.status}). Is api.py running?`);
  return data as T;
}

export function BeanCounter() {
  const [state, setState] = useState<State | null>(null);
  const [lastRun, setLastRun] = useState<Decision[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [why, setWhy] = useState<Why | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const act = useCallback(async <T,>(key: string, fn: () => Promise<T>) => {
    setError(null);
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    call<State>("/state").then(setState).catch((e) => setError((e as Error).message));
  }, []);

  async function runAgent() {
    const r = await act("run", () => call<State & { results: Decision[] }>("/run", {}));
    if (r) {
      setState(r);
      setLastRun(r.results);
      setFlash(null);
    }
  }

  async function decide(d: Decision, verb: "approve" | "reject") {
    const r = await act(`${verb}-${d.id}`, () => call<State & { result: Decision }>(`/${verb}/${d.id}`, {}));
    if (!r) return;
    setState(r);
    const out = r.result;
    setFlash(
      verb === "reject"
        ? `Rejected ${d.item_name} from ${d.supplier}.`
        : out.payment_intent
          ? `Paid ${gbp(out.total)} to ${out.supplier}. Stripe ${out.payment_intent}`
          : `The policy guard blocked it: ${out.reasoning}`,
    );
  }

  async function ask(q: string) {
    setQuestion(q);
    setWhy(null);
    const r = await act("why", () => call<Why>("/why", { question: q }));
    if (r) setWhy(r);
  }

  async function mutate(path: string, body: unknown = {}) {
    const r = await act(path, () => call<State>(path, body));
    if (r) {
      setState(r);
      if (path === "/reset") {
        setLastRun([]);
        setWhy(null);
        setFlash(null);
      }
    }
  }

  const piUrl = (pi: string) => `${state?.dashboard_base ?? ""}${pi}`;
  const m = state?.metrics;

  return (
    <div className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="btn-primary grid size-9 place-items-center rounded-xl font-display text-sm font-bold">B</span>
          <span className="font-display text-lg font-semibold tracking-tight">BeanCounter</span>
          <span className="hidden text-sm text-muted sm:inline">for Bean &amp; Leaf Coffee</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => mutate("/reset")}
            disabled={busy !== null}
            className="text-xs text-muted hover:text-foreground disabled:opacity-40"
          >
            Reset demo
          </button>
          <span className="flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs text-muted backdrop-blur">
            <span className="size-1.5 rounded-full bg-warn" />
            Stripe test mode
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-2 sm:px-6">
        <section className="relative isolate -mx-4 px-4 pb-2 sm:-mx-6 sm:px-6">
          <div className="rings absolute inset-0 -z-10" aria-hidden />
          <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            <span className="gradient-text">Your finance team, Bob.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">
            BeanCounter watches your stock, buys from the cheapest approved supplier, and stays inside your written
            policy. Small orders go through on their own. Big ones wait for you. Every pound points back to a clause.
          </p>
        </section>

        {error && <Banner tone="bad">{error}</Banner>}

        {m && (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Spent today" value={gbp(m.spent_today)} hint="§5" />
            <Metric label="Daily cap left" value={gbp(m.daily_cap - m.spent_today)} hint={`of ${gbp(m.daily_cap)}`} />
            <Metric label="Auto-approve up to" value={gbp(m.auto_limit)} hint="§3 / §4" />
            <Metric label="Waiting for you" value={String(state.pending.length)} hint="approvals" />
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr]">
          {/* ------------------------------------------------ left column */}
          <div className="space-y-6">
            <Card title="Stock" step={1}>
              <div className="overflow-x-auto">
                <table className="tabular w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 text-right font-medium">On hand</th>
                      <th className="px-3 py-2 text-right font-medium">Reorder below</th>
                      <th className="px-3 py-2 text-right font-medium">Par</th>
                      <th className="px-3 py-2 text-right font-medium">Last paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {state?.stock.map((s) => (
                      <tr key={s.id}>
                        <td className="px-3 py-2.5">
                          <span className={`mr-2 inline-block size-2 rounded-full ${s.low ? "bg-[#ff6b8a]" : "bg-good"}`} />
                          {s.name}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            min={0}
                            aria-label={`Count of ${s.name}`}
                            value={edits[s.id] ?? String(s.qty)}
                            onChange={(e) => setEdits({ ...edits, [s.id]: e.target.value })}
                            onBlur={() => {
                              const v = edits[s.id];
                              if (v !== undefined && Number(v) !== s.qty) mutate("/stock", { item: s.id, qty: Number(v) });
                              setEdits((prev) => {
                                const next = { ...prev };
                                delete next[s.id];
                                return next;
                              });
                            }}
                            className="w-16 rounded-lg border border-line bg-background/60 px-2 py-1 text-right outline-none focus:border-orchid"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted">{s.reorder_level}</td>
                        <td className="px-3 py-2.5 text-right text-muted">{s.par}</td>
                        <td className="px-3 py-2.5 text-right text-muted">{gbp(s.last_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <PrimaryButton onClick={runAgent} disabled={busy !== null} loading={busy === "run"} loadingLabel="Checking stock, quotes and policy…">
                  Run BeanCounter
                </PrimaryButton>
                <button
                  onClick={() => mutate("/simulate")}
                  disabled={busy !== null}
                  className="rounded-full border border-line px-4 py-2.5 text-sm text-muted transition hover:text-foreground disabled:opacity-40"
                >
                  Simulate a morning rush
                </button>
              </div>
            </Card>

            {lastRun.length > 0 && (
              <Card title="What I just did" step={2}>
                <div className="space-y-3">
                  {lastRun.map((d) => (
                    <DecisionCard key={d.id} d={d} piUrl={piUrl} />
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* ------------------------------------------------ right column */}
          <div className="space-y-6">
            <Card title="Waiting for your approval" step={3}>
              {flash && <Banner tone={flash.startsWith("Paid") ? "good" : "warn"}>{flash}</Banner>}
              {state && state.pending.length === 0 && <p className="text-sm text-muted">Nothing waiting for you.</p>}
              <div className="space-y-3">
                {state?.pending.map((d) => (
                  <div key={d.id} className="gradient-border rounded-2xl p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-semibold">{d.item_name}</div>
                      <div className="tabular font-display text-lg font-semibold">{gbp(d.total)}</div>
                    </div>
                    <div className="tabular mt-1 text-sm text-muted">
                      {d.qty} × {gbp(d.unit_price)} from <span className="text-foreground/80">{d.supplier}</span>
                    </div>
                    <p className="mt-2 text-sm">
                      <Clauses ids={d.clause_ids} /> {d.reasoning}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <PrimaryButton onClick={() => decide(d, "approve")} disabled={busy !== null} loading={busy === `approve-${d.id}`} loadingLabel="Paying…">
                        Approve
                      </PrimaryButton>
                      <button
                        onClick={() => decide(d, "reject")}
                        disabled={busy !== null}
                        className="rounded-full border border-line px-5 py-2.5 text-sm font-medium text-muted transition hover:text-foreground disabled:opacity-40"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Ask why" step={4}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (question.trim()) ask(question.trim());
                }}
                className="flex gap-2"
              >
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Why did you buy oat milk from Booker?"
                  aria-label="Ask BeanCounter why"
                  className="min-w-0 flex-1 rounded-full border border-line bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-orchid"
                />
                <PrimaryButton onClick={() => question.trim() && ask(question.trim())} disabled={busy !== null || !question.trim()} loading={busy === "why"} loadingLabel="Asking…">
                  Ask
                </PrimaryButton>
              </form>
              <div className="mt-3 flex flex-wrap gap-2">
                {["Why did you buy oat milk from Booker?", "Why didn't you buy croissants?", "Why not CheapBeans?"].map((q) => (
                  <button
                    key={q}
                    onClick={() => ask(q)}
                    disabled={busy !== null}
                    className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>
              {why && (
                <div className="mt-4 space-y-3">
                  <div className="text-xs uppercase tracking-wide text-muted">
                    Answered from {why.source === "cognee" ? "Cognee memory" : "the audit log"}
                  </div>
                  <p className="whitespace-pre-line text-sm leading-relaxed">{why.answer}</p>
                  {why.source === "cognee" && why.evidence && (
                    <details open className="rounded-2xl border border-line bg-background/40 p-3">
                      <summary className="cursor-pointer text-xs text-muted">Evidence from the audit log</summary>
                      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-foreground/80">{why.evidence}</p>
                    </details>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>

        <div className="mt-6">
          <Card title="Audit log" step={5}>
            {state && state.log.length === 0 ? (
              <p className="text-sm text-muted">No decisions yet. Run BeanCounter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tabular w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 font-medium">Decision</th>
                      <th className="px-3 py-2 font-medium">Supplier</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      <th className="px-3 py-2 font-medium">Clauses</th>
                      <th className="px-3 py-2 font-medium">By</th>
                      <th className="px-3 py-2 font-medium">Stripe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {state?.log.map((d) => (
                      <tr key={d.id}>
                        <td className="px-3 py-2 text-muted">{d.ts?.slice(11, 19)}</td>
                        <td className="px-3 py-2">{d.item_name}</td>
                        <td className="px-3 py-2"><ActionPill action={d.action} /></td>
                        <td className="px-3 py-2 text-muted">{d.supplier ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{gbp(d.total)}</td>
                        <td className="px-3 py-2"><Clauses ids={d.clause_ids} /></td>
                        <td className="px-3 py-2 text-muted">{d.approved_by ?? ""}</td>
                        <td className="px-3 py-2">
                          {d.payment_intent ? (
                            <a href={piUrl(d.payment_intent)} target="_blank" rel="noreferrer" className="text-glacier underline-offset-4 hover:underline">
                              {d.payment_intent.slice(0, 14)}…
                            </a>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {state && (
          <details className="mt-6 rounded-3xl border border-line bg-surface/80 p-5 backdrop-blur">
            <summary className="cursor-pointer font-display font-semibold">
              Purchasing policy <span className="ml-2 text-sm font-normal text-muted">enforced in code, not just the prompt</span>
            </summary>
            <ul className="mt-3 space-y-1.5 text-sm">
              {state.policy.map((p) => (
                <li key={p}>
                  <span className="font-semibold text-glacier">{p.split(" ")[0]}</span> {p.split(" ").slice(1).join(" ")}
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>
    </div>
  );
}

function DecisionCard({ d, piUrl }: { d: Decision; piUrl: (pi: string) => string }) {
  return (
    <article className="rounded-2xl border border-line bg-background/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{d.item_name}</span>
          <ActionPill action={d.action} />
        </div>
        {d.action !== "no_action" && <span className="tabular font-display font-semibold">{gbp(d.total)}</span>}
      </div>
      {d.action !== "no_action" && (
        <div className="tabular mt-1 text-sm text-muted">
          {d.qty} × {gbp(d.unit_price)} from <span className="text-foreground/80">{d.supplier}</span>
        </div>
      )}
      <p className="mt-2 text-sm">
        <Clauses ids={d.clause_ids} /> {d.reasoning}
      </p>
      {d.skipped_quotes?.map((s) => (
        <p key={s.supplier} className="tabular mt-1 text-xs text-muted">
          Skipped {s.supplier} at {gbp(s.unit_price)} ({s.clause}: {s.reason})
        </p>
      ))}
      {d.payment_intent && (
        <a href={piUrl(d.payment_intent)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-glacier underline-offset-4 hover:underline">
          View payment in Stripe: {d.payment_intent}
        </a>
      )}
    </article>
  );
}

function ActionPill({ action }: { action: string }) {
  const a = ACTIONS[action] ?? { label: action, tone: "muted" as const };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[a.tone]}`}>{a.label}</span>;
}

function Clauses({ ids }: { ids: string[] }) {
  return (
    <span className="mr-1 inline-flex gap-1 align-middle">
      {ids.map((c) => (
        <span key={c} className="rounded-md bg-orchid/15 px-1.5 py-0.5 text-xs font-semibold text-orchid">{c}</span>
      ))}
    </span>
  );
}

function Card({ title, step, children }: { title: string; step: number; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-surface/80 p-5 backdrop-blur">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
        <span className="tabular grid size-6 place-items-center rounded-full bg-white/5 text-xs text-muted">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/70 px-4 py-3 backdrop-blur">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular font-display text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted">{hint}</div>
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
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="btn-primary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.loading && <span className="size-4 animate-spin rounded-full border-2 border-black/20 border-t-black/70" />}
      {props.loading ? props.loadingLabel : props.children}
    </button>
  );
}

function Banner({ tone, children }: { tone: "good" | "warn" | "bad"; children: React.ReactNode }) {
  return (
    <div role="status" className={`mb-4 rounded-2xl px-4 py-3 text-sm ${TONE[tone]}`}>
      {children}
    </div>
  );
}
