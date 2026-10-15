import { Suspense } from "react";
import Link from "next/link";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { supplierById } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { ClearSavedState } from "./ClearSavedState";

export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    <Suspense fallback={<Shell title="Loading your order…" />}>
      <OrderDetails searchParams={searchParams} />
    </Suspense>
  );
}

async function OrderDetails({ searchParams }: Pick<PageProps<"/orders">, "searchParams">) {
  const { session_id } = await searchParams;
  if (typeof session_id !== "string") return <Shell title="No order found" />;

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.retrieve(session_id, {
      expand: ["line_items.data.price.product"],
    });
  } catch {
    return <Shell title="We couldn't load that order" />;
  }

  const paid = session.payment_status === "paid";
  const groups = new Map<string, { name: string; lines: Stripe.LineItem[]; subtotal: number }>();
  for (const li of session.line_items?.data ?? []) {
    const product = li.price?.product as Stripe.Product | undefined;
    const supplierId = product?.metadata.supplierId ?? "unknown";
    const g = groups.get(supplierId) ?? {
      name: product?.metadata.supplierName ?? "Supplier",
      lines: [],
      subtotal: 0,
    };
    g.lines.push(li);
    g.subtotal += li.amount_total / 100;
    groups.set(supplierId, g);
  }

  return (
    <Shell title={paid ? "Done. Your orders are placed." : "Payment pending"}>
      {paid && <ClearSavedState />}
      <p className="mt-2 text-muted">
        {paid
          ? `Paid ${usd((session.amount_total ?? 0) / 100)} in Stripe test mode. The agent has split your purchase into one order per supplier.`
          : "Stripe hasn't confirmed this payment yet."}
      </p>

      <div className="mt-8 space-y-4">
        {[...groups.entries()].map(([id, g], idx) => {
          const supplier = supplierById.get(id);
          return (
            <article key={id} className="rounded-xl border border-line bg-surface">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted">
                    PO-{session.id.slice(-6).toUpperCase()}-{idx + 1}
                  </div>
                  <h2 className="font-medium">{g.name}</h2>
                </div>
                <div className="text-sm text-muted">
                  {supplier ? `Arrives in about ${supplier.deliveryDays} day${supplier.deliveryDays > 1 ? "s" : ""}` : ""}
                </div>
              </header>
              <ul className="divide-y divide-line">
                {g.lines.map((li) => (
                  <li key={li.id} className="tabular flex justify-between gap-4 px-5 py-2.5 text-sm">
                    <span>
                      {li.quantity} × {li.description}
                    </span>
                    <span>{usd(li.amount_total / 100)}</span>
                  </li>
                ))}
              </ul>
              <div className="tabular flex justify-between border-t border-line px-5 py-3 font-medium">
                <span>Subtotal</span>
                <span>{usd(g.subtotal)}</span>
              </div>
            </article>
          );
        })}
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
      {children}
      <Link href="/" className="mt-8 inline-block text-sm text-accent underline-offset-4 hover:underline">
        ← Start a new restock
      </Link>
    </main>
  );
}
