import Link from "next/link";
import { usd } from "@/lib/format";
import { groupBySupplier, type OrderLine } from "@/lib/orders";

export interface OrderGroupView {
  key: string;
  supplierName: string;
  deliveryDays: number | null;
  lines: { key: string; label: string; total: number }[];
  subtotal: number;
}

export function OrderCards({ groups, refPrefix }: { groups: OrderGroupView[]; refPrefix?: string }) {
  return (
    <div className="mt-8 space-y-4">
      {groups.map((g, idx) => (
        <article key={g.key} className="rounded-3xl border border-line bg-surface/80 backdrop-blur">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
            <div>
              {refPrefix && <div className="tabular text-xs text-muted">PO-{refPrefix}-{idx + 1}</div>}
              <h2 className="font-display font-semibold">{g.supplierName}</h2>
            </div>
            {g.deliveryDays != null && (
              <div className="text-sm text-muted">
                Arrives in about {g.deliveryDays} day{g.deliveryDays > 1 ? "s" : ""}
              </div>
            )}
          </header>
          <ul className="divide-y divide-line">
            {g.lines.map((l) => (
              <li key={l.key} className="tabular flex justify-between gap-4 px-5 py-3 text-sm">
                <span>{l.label}</span>
                <span>{usd(l.total)}</span>
              </li>
            ))}
          </ul>
          <div className="tabular flex justify-between border-t border-line px-5 py-3 font-semibold">
            <span>Subtotal</span>
            <span>{usd(g.subtotal)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

export function PageShell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {children}
      <Link href="/" className="mt-10 inline-block text-sm font-medium text-glacier underline-offset-4 hover:underline">
        Start a new restock
      </Link>
    </main>
  );
}

export function toView(lines: OrderLine[]): OrderGroupView[] {
  return groupBySupplier(lines).map((g) => ({
    key: g.supplier.id,
    supplierName: g.supplier.name,
    deliveryDays: g.supplier.deliveryDays,
    lines: g.lines.map((l) => ({
      key: l.product.sku,
      label: `${l.packs} × ${l.product.name} (${l.product.packLabel})`,
      total: l.total,
    })),
    subtotal: g.subtotal,
  }));
}
