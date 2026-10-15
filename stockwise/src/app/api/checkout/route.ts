import { productBySku, supplierById } from "@/lib/catalog";
import { CheckoutRequestSchema } from "@/lib/schemas";
import { UserFacingError, errorResponse } from "@/lib/claude";
import { getStripe } from "@/lib/stripe";
import { encodeDemoOrder } from "@/lib/orders";

export async function POST(request: Request) {
  try {
    const body = CheckoutRequestSchema.safeParse(await request.json());
    if (!body.success) throw new UserFacingError("Nothing approved to buy.");

    // Prices always come from the catalog, never from the browser.
    const lineItems = body.data.lines.map(({ sku, packs }) => {
      const p = productBySku.get(sku);
      if (!p) throw new UserFacingError(`Unknown product ${sku}.`);
      const supplier = supplierById.get(p.supplierId)!;
      return {
        quantity: packs,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(p.pricePerPack * 100),
          product_data: {
            name: `${p.name} (${p.packLabel})`,
            description: `Supplier: ${supplier.name}`,
            metadata: { sku: p.sku, supplierId: supplier.id, supplierName: supplier.name },
          },
        },
      };
    });

    // The agent never spends more than the budget Bob set.
    const budget = body.data.budget ?? null;
    const orderTotal = lineItems.reduce((sum, l) => sum + l.quantity * l.price_data.unit_amount, 0) / 100;
    if (budget && orderTotal > budget + 0.005) {
      throw new UserFacingError(
        `This order comes to $${orderTotal.toFixed(2)}, which is over your $${budget.toFixed(2)} budget.`,
      );
    }

    // Demo mode: without a Stripe key, hand off to the in-app demo checkout instead.
    if (!process.env.STRIPE_SECRET_KEY) {
      return Response.json({ url: `/checkout/demo?o=${encodeURIComponent(encodeDemoOrder(body.data.lines))}` });
    }

    const origin = new URL(request.url).origin;
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url: `${origin}/orders?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?cancelled=1`,
    });

    return Response.json({ url: session.url });
  } catch (err) {
    return errorResponse(err);
  }
}
