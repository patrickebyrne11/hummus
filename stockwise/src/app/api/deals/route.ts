import { z } from "zod";
import { catalogForPrompt, productBySku, supplierById } from "@/lib/catalog";
import {
  DealsResultSchema,
  InventoryItemSchema,
  type InventoryItem,
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

// Speed: one call per small group of items, run in parallel, instead of one long call that
// writes every option for every item in sequence. Same model, prompt and effort per group.
const GROUP_SIZE = 2;
const MAX_PARALLEL = 5; // stay well inside subscription / API rate limits
const GroupResultSchema = DealsResultSchema.pick({ items: true });

async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}

function describe(it: InventoryItem, i: number) {
  return (
    `${i}. ${it.name} — need ${it.quantity} ${it.unit}` +
    (it.currentUnitPrice != null ? `, currently pays $${it.currentUnitPrice}/${it.unit}` : "") +
    (it.currentSupplier ? ` from ${it.currentSupplier}` : "")
  );
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The plan summary, built from the server-priced deals so every number is exact. */
function summarise(deals: ItemDeal[]) {
  const picked = deals.flatMap((d) => {
    const o = d.options.find((x) => x.sku === d.recommendedSku);
    return o ? [{ d, o }] : [];
  });
  const total = picked.reduce((s, p) => s + p.o.total, 0);
  const suppliers = new Set(picked.map((p) => p.o.supplierName));
  const comparable = picked.filter((p) => p.d.currentCost != null);
  const saving = comparable.reduce((s, p) => s + (p.d.currentCost! - p.o.total), 0);
  const missing = deals.filter((d) => !d.recommendedSku).map((d) => d.item.name);
  const parts = [
    `I found a best deal for ${picked.length} of ${deals.length} items across ${suppliers.size} supplier${suppliers.size === 1 ? "" : "s"}, ${usd(total)} in total.`,
  ];
  if (comparable.length > 0) {
    parts.push(
      saving >= 0
        ? `On the ${comparable.length} items where you told me today's price, that saves ${usd(saving)}.`
        : `On the ${comparable.length} items where you told me today's price, that costs ${usd(-saving)} more, usually for better quality.`,
    );
  }
  if (missing.length > 0) parts.push(`Nothing in the catalog fits: ${missing.join(", ")}.`);
  return parts.join(" ");
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

    const groups: { item: InventoryItem; i: number }[][] = [];
    items.forEach((item, i) => {
      if (i % GROUP_SIZE === 0) groups.push([]);
      groups[groups.length - 1].push({ item, i });
    });

    const groupResults = await mapLimit(groups, MAX_PARALLEL, (g) =>
      structuredCall({
        schema: GroupResultSchema,
        system: SYSTEM,
        user: `Items from Bob's list (keep these index numbers as itemIndex):\n${g.map(({ item, i }) => describe(item, i)).join("\n")}`,
        effort: "low",
      }),
    );
    const result = { items: groupResults.flatMap((r) => r.items) };

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

    return Response.json({ deals, summary: summarise(deals) });
  } catch (err) {
    return errorResponse(err);
  }
}
