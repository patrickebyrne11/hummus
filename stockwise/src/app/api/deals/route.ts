import { z } from "zod";
import { catalogForPrompt, productBySku, supplierById } from "@/lib/catalog";
import {
  DealsResultSchema,
  InventoryItemSchema,
  type ItemDeal,
  type PricedOption,
} from "@/lib/schemas";
import { UserFacingError, errorResponse, structuredCall } from "@/lib/claude";

const RequestSchema = z.object({ items: z.array(InventoryItemSchema).min(1).max(150) });

const SYSTEM = `You are a purchasing agent for Bob, who runs an independent coffee shop. Your job is to find Bob the best deal for each item on his list from the wholesale catalog below.

"Best" means best value for a café, not just the lowest price:
- The product must genuinely fit what Bob asked for. Barista-edition plant milk is not interchangeable with retail cartons; compostable cups are not interchangeable with PE-lined ones if Bob's item says compostable; size (8/12/16 oz) must match.
- Prefer a lower price per canonical unit, but call out quality trade-offs (commodity vs specialty coffee, for example).
- Consider pack size waste: a huge case that Bob will over-buy may be worse than smaller packs.
- Consider delivery time and supplier minimum order; consolidating items onto fewer suppliers is a plus.
- Only use SKUs whose canonical unit matches the item's unit.

For each item, list up to 3 suitable options (best first) and pick a recommendedSku. If nothing in the catalog fits, return no options and explain in "note". Never invent SKUs.

${catalogForPrompt()}`;

function priceOption(
  qty: number,
  unit: string,
  sku: string,
  why: string,
): PricedOption | null {
  const p = productBySku.get(sku);
  if (!p || p.unit !== unit || qty <= 0) return null;
  const s = supplierById.get(p.supplierId)!;
  const packs = Math.ceil(qty / p.unitsPerPack - 1e-9);
  return {
    sku,
    productName: p.name,
    supplierId: s.id,
    supplierName: s.name,
    packLabel: p.packLabel,
    packs,
    unitsBought: round(packs * p.unitsPerPack),
    unitPrice: round(p.pricePerPack / p.unitsPerPack, 4),
    total: round(packs * p.pricePerPack),
    deliveryDays: s.deliveryDays,
    rating: s.rating,
    why,
  };
}

function round(n: number, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export async function POST(request: Request) {
  try {
    const body = RequestSchema.safeParse(await request.json());
    if (!body.success) throw new UserFacingError("Invalid item list.");
    const { items } = body.data;

    const list = items
      .map(
        (it, i) =>
          `${i}. ${it.name} — need ${it.quantity} ${it.unit}` +
          (it.currentUnitPrice != null ? `, currently pays $${it.currentUnitPrice}/${it.unit}` : "") +
          (it.currentSupplier ? ` from ${it.currentSupplier}` : ""),
      )
      .join("\n");

    const result = await structuredCall({
      schema: DealsResultSchema,
      system: SYSTEM,
      user: `Bob's list:\n${list}`,
      effort: "low",
    });

    // The model picks products; the server does all the money math from the catalog.
    const byIndex = new Map(result.items.map((d) => [d.itemIndex, d]));
    const deals: ItemDeal[] = items.map((item, i) => {
      const d = byIndex.get(i);
      const options = (d?.options ?? [])
        .map((o) => priceOption(item.quantity, item.unit, o.sku, o.why))
        .filter((o): o is PricedOption => o !== null);
      const recommended =
        d?.recommendedSku && options.some((o) => o.sku === d.recommendedSku)
          ? d.recommendedSku
          : (options[0]?.sku ?? null);
      return {
        item,
        options,
        recommendedSku: recommended,
        currentCost:
          item.currentUnitPrice != null ? round(item.currentUnitPrice * item.quantity) : null,
        note: d?.note ?? (options.length === 0 ? "No matching product in the catalog." : null),
      };
    });

    return Response.json({ deals, summary: result.summary });
  } catch (err) {
    return errorResponse(err);
  }
}
