import { Suspense } from "react";
import Link from "next/link";
import { usd } from "@/lib/format";
import { decodeDemoOrder } from "@/lib/orders";
import { OrderCards, PageShell, toView } from "@/components/OrderCards";

// Stand-in for Stripe Checkout when no Stripe key is configured. No card details are collected.
export default function DemoCheckoutPage({ searchParams }: PageProps<"/checkout/demo">) {
  return (
    <Suspense fallback={<PageShell title="Loading checkout…" />}>
      <DemoCheckout searchParams={searchParams} />
    </Suspense>
  );
}

async function DemoCheckout({ searchParams }: Pick<PageProps<"/checkout/demo">, "searchParams">) {
  const { o } = await searchParams;
  const lines = typeof o === "string" ? decodeDemoOrder(o) : [];
  if (!lines.length) return <PageShell title="Nothing to pay for" />;
  const total = lines.reduce((s, l) => s + l.total, 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
      <Link
        href="/?cancelled=1"
        className="-ml-2 mb-4 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium text-muted transition hover:bg-foreground/5 hover:text-foreground"
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12.5 15 7.5 10l5-5" />
        </svg>
        <span><span className="sr-only">Back to </span>Review deals</span>
      </Link>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Confirm your order</h1>
      <p className="mt-3 text-lg text-muted">
        This is a demo checkout. No card is needed and no money moves. With a Stripe key set, this step becomes a real
        Stripe test-mode payment.
      </p>

      <OrderCards groups={toView(lines)} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-line bg-surface-2/85 px-5 py-4 backdrop-blur-xl">
        <div>
          <div className="text-sm text-muted">Total</div>
          <div className="tabular font-display text-2xl font-bold">{usd(total)}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/?cancelled=1" className="rounded-full px-4 py-3 text-sm text-muted hover:text-foreground">
            Cancel
          </Link>
          <Link
            href={`/orders?demo=${encodeURIComponent(o as string)}`}
            className="btn-primary inline-flex rounded-full px-6 py-3 font-bold"
          >
            Pay {usd(total)}
          </Link>
        </div>
      </div>
    </main>
  );
}
