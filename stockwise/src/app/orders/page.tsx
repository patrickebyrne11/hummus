import { Suspense } from "react";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { supplierById } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { decodeDemoOrder, groupBySupplier } from "@/lib/orders";
import { OrderCards, PageShell, toView, type OrderGroupView } from "@/components/OrderCards";
import { ClearSavedState } from "./ClearSavedState";

export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    <Suspense fallback={<PageShell title="Loading your order…" />}>
      <OrderDetails searchParams={searchParams} />
    </Suspense>
  );
}

async function OrderDetails({ searchParams }: Pick<PageProps<"/orders">, "searchParams">) {
  const { session_id, demo } = await searchParams;
  if (typeof demo === "string") return <DemoOrder encoded={demo} />;
  if (typeof session_id !== "string") return <PageShell title="No order found" />;

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.retrieve(session_id, {
      expand: ["line_items.data.price.product"],
    });
  } catch {
    return <PageShell title="We couldn't load that order" />;
  }

  const paid = session.payment_status === "paid";
  const groups = new Map<string, OrderGroupView>();
  for (const li of session.line_items?.data ?? []) {
    const product = li.price?.product as Stripe.Product | undefined;
    const supplierId = product?.metadata.supplierId ?? "unknown";
    const g = groups.get(supplierId) ?? {
      key: supplierId,
      supplierName: product?.metadata.supplierName ?? "Supplier",
      deliveryDays: supplierById.get(supplierId)?.deliveryDays ?? null,
      lines: [],
      subtotal: 0,
    };
    g.lines.push({ key: li.id, label: `${li.quantity} × ${li.description}`, total: li.amount_total / 100 });
    g.subtotal += li.amount_total / 100;
    groups.set(supplierId, g);
  }

  return (
    <PageShell title={paid ? "Done. Your orders are placed." : "Payment pending"}>
      {paid && <ClearSavedState />}
      <p className="mt-3 text-lg text-muted">
        {paid
          ? `Paid ${usd((session.amount_total ?? 0) / 100)} in Stripe test mode, split into one order per supplier.`
          : "Stripe hasn't confirmed this payment yet."}
      </p>
      <OrderCards groups={[...groups.values()]} refPrefix={session.id.slice(-6).toUpperCase()} />
    </PageShell>
  );
}

function DemoOrder({ encoded }: { encoded: string }) {
  const lines = decodeDemoOrder(encoded);
  if (!lines.length) return <PageShell title="No order found" />;
  const total = lines.reduce((s, l) => s + l.total, 0);
  const ref = encoded.length.toString(36).toUpperCase().padStart(3, "0") + lines.length;

  return (
    <PageShell title="Done. Your orders are placed.">
      <ClearSavedState />
      <p className="mt-3 text-lg text-muted">
        {usd(total)} across {groupBySupplier(lines).length} suppliers, split into one order each. This is a demo, so no
        money moved and no supplier was contacted.
      </p>
      <OrderCards groups={toView(lines)} refPrefix={`DEMO${ref}`} />
    </PageShell>
  );
}
