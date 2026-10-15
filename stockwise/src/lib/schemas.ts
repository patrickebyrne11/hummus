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
      "Any conversion or guess you had to make, as a short phrase (e.g. '1 case = 1,000 cups'). null if none.",
    ),
  // Stock position, when the input gives it. Shortage is worked out by the server, not the model.
  onHand: z.number().nullable().optional(),
  par: z.number().nullable().optional(),
  shortage: z.enum(["out", "severe", "low"]).nullable().optional(),
});

/** What the model fills in when reading a list: the item plus its stock position. */
export const ParsedItemSchema = InventoryItemSchema.omit({ shortage: true }).extend({
  onHand: z
    .number()
    .nullable()
    .describe("Amount currently in stock, in the canonical unit. null if the input doesn't say."),
  par: z
    .number()
    .nullable()
    .describe("Target / par level, in the canonical unit. null if the input doesn't say."),
  flaggedUrgent: z
    .boolean()
    .describe("true if the input says this item is out, nearly out, or urgent"),
});

export const ParsedInventorySchema = z.object({
  items: z.array(ParsedItemSchema),
  skipped: z
    .array(z.string())
    .describe("Rows or lines that are not purchasable stock items, with a short reason"),
});

export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const DealOptionSchema = z.object({
  sku: z.string().describe("Exact SKU from the catalog"),
  why: z
    .string()
    .describe("Why this option, as a short plain phrase of at most 8 words, e.g. 'Cheapest per kg, same grade'"),
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
    .describe("Only if needed: a short plain phrase about a catch, e.g. 'Retail carton, not barista'. null otherwise"),
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

export const BudgetSchema = z.number().positive().max(10_000_000).nullable().optional();

export const CheckoutRequestSchema = z.object({
  budget: BudgetSchema,
  lines: z
    .array(z.object({ sku: z.string(), packs: z.number().int().positive().max(500) }))
    .min(1),
});
