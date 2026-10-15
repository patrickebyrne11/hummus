import { z } from "zod";

export const InventoryItemSchema = z.object({
  name: z.string().describe("Item name as Bob would recognise it"),
  quantity: z
    .number()
    .describe("Quantity Bob needs to buy, converted to the canonical unit"),
  unit: z.enum(["kg", "L", "unit"]).describe("Canonical unit"),
  currentUnitPrice: z
    .number()
    .nullable()
    .describe(
      "What Bob currently pays per ONE canonical unit (per kg, per L, or per single item). null if unknown.",
    ),
  currentSupplier: z.string().nullable(),
  assumption: z
    .string()
    .nullable()
    .describe(
      "Any conversion or interpretation you had to make, in one short sentence. null if none.",
    ),
});

export const ParsedInventorySchema = z.object({
  items: z.array(InventoryItemSchema),
  skipped: z
    .array(z.string())
    .describe("Rows or lines that are not purchasable stock items, with a short reason"),
});

export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const DealOptionSchema = z.object({
  sku: z.string().describe("Exact SKU from the catalog"),
  why: z.string().describe("One sentence on why this option fits or what the trade-off is"),
});

export const ItemDealsSchema = z.object({
  itemIndex: z.number().int().describe("Index of the item in Bob's list"),
  options: z
    .array(DealOptionSchema)
    .describe("Up to 3 suitable catalog options, best first. Empty if nothing in the catalog fits."),
  recommendedSku: z.string().nullable(),
  note: z
    .string()
    .nullable()
    .describe("Anything Bob should know: quality differences, no match found, substitutions"),
});

export const DealsResultSchema = z.object({
  items: z.array(ItemDealsSchema),
  summary: z.string().describe("Two or three sentences for Bob summarising the plan"),
});

export type DealsResult = z.infer<typeof DealsResultSchema>;

// Priced deal as returned to the browser (server computes all money values).
export interface PricedOption {
  sku: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  packLabel: string;
  packs: number;
  unitsBought: number;
  unitPrice: number;
  total: number;
  deliveryDays: number;
  rating: number;
  why: string;
}

export interface ItemDeal {
  item: InventoryItem;
  options: PricedOption[];
  recommendedSku: string | null;
  currentCost: number | null;
  note: string | null;
}

export const CheckoutRequestSchema = z.object({
  lines: z
    .array(z.object({ sku: z.string(), packs: z.number().int().positive().max(500) }))
    .min(1),
});
