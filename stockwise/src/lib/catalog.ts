// Mock wholesale supplier catalog. Prices are illustrative, in USD.
// `unitsPerPack` is expressed in the product's canonical `unit` so the server
// can compute pack counts and costs deterministically.

export type CanonicalUnit = "kg" | "L" | "unit";

export interface Supplier {
  id: string;
  name: string;
  deliveryDays: number;
  minOrderUsd: number;
  rating: number; // 1–5
}

export interface Product {
  sku: string;
  supplierId: string;
  name: string;
  category: string;
  unit: CanonicalUnit;
  unitsPerPack: number;
  packLabel: string;
  pricePerPack: number;
  notes?: string;
}

export const SUPPLIERS: Supplier[] = [
  { id: "roastline", name: "Roastline Wholesale", deliveryDays: 2, minOrderUsd: 150, rating: 4.7 },
  { id: "dairydirect", name: "DairyDirect", deliveryDays: 1, minOrderUsd: 80, rating: 4.5 },
  { id: "greencup", name: "GreenCup Packaging", deliveryDays: 4, minOrderUsd: 120, rating: 4.4 },
  { id: "sweetsyrup", name: "Sweet Syrup Co.", deliveryDays: 3, minOrderUsd: 60, rating: 4.6 },
  { id: "metro", name: "Metro Cash & Carry", deliveryDays: 1, minOrderUsd: 0, rating: 4.0 },
  { id: "bakehouse", name: "Bakehouse Supply", deliveryDays: 2, minOrderUsd: 100, rating: 4.3 },
];

export const PRODUCTS: Product[] = [
  // Coffee
  { sku: "RL-ESP-HOUSE-5", supplierId: "roastline", name: "House Espresso Blend, whole bean", category: "coffee", unit: "kg", unitsPerPack: 5, packLabel: "5 kg bag", pricePerPack: 92 },
  { sku: "RL-ESP-SO-ETH-1", supplierId: "roastline", name: "Single Origin Ethiopia Yirgacheffe, whole bean", category: "coffee", unit: "kg", unitsPerPack: 1, packLabel: "1 kg bag", pricePerPack: 31 },
  { sku: "RL-DECAF-SWISS-1", supplierId: "roastline", name: "Swiss Water Decaf, whole bean", category: "coffee", unit: "kg", unitsPerPack: 1, packLabel: "1 kg bag", pricePerPack: 27 },
  { sku: "MT-ESP-BLEND-1", supplierId: "metro", name: "Metro Espresso Blend, whole bean", category: "coffee", unit: "kg", unitsPerPack: 1, packLabel: "1 kg bag", pricePerPack: 19.5, notes: "Commodity-grade blend" },
  { sku: "MT-DECAF-1", supplierId: "metro", name: "Decaf Espresso, whole bean", category: "coffee", unit: "kg", unitsPerPack: 1, packLabel: "1 kg bag", pricePerPack: 23 },
  { sku: "MT-COLDBREW-CONC-4", supplierId: "metro", name: "Cold Brew Concentrate", category: "coffee", unit: "L", unitsPerPack: 4, packLabel: "4 L jug", pricePerPack: 38 },

  // Milk & alternatives
  { sku: "DD-WHOLE-4", supplierId: "dairydirect", name: "Whole Milk", category: "milk", unit: "L", unitsPerPack: 4, packLabel: "4 L jug", pricePerPack: 5.6 },
  { sku: "DD-SKIM-4", supplierId: "dairydirect", name: "Skim Milk", category: "milk", unit: "L", unitsPerPack: 4, packLabel: "4 L jug", pricePerPack: 5.2 },
  { sku: "DD-OAT-BARISTA-12", supplierId: "dairydirect", name: "Oat Milk Barista Edition", category: "milk-alt", unit: "L", unitsPerPack: 12, packLabel: "case of 12 × 1 L", pricePerPack: 33 },
  { sku: "DD-ALMOND-BARISTA-12", supplierId: "dairydirect", name: "Almond Milk Barista Edition", category: "milk-alt", unit: "L", unitsPerPack: 12, packLabel: "case of 12 × 1 L", pricePerPack: 31 },
  { sku: "DD-SOY-BARISTA-12", supplierId: "dairydirect", name: "Soy Milk Barista Edition", category: "milk-alt", unit: "L", unitsPerPack: 12, packLabel: "case of 12 × 1 L", pricePerPack: 26 },
  { sku: "MT-WHOLE-2", supplierId: "metro", name: "Whole Milk", category: "milk", unit: "L", unitsPerPack: 2, packLabel: "2 L bottle", pricePerPack: 3.1 },
  { sku: "MT-OAT-1", supplierId: "metro", name: "Oat Milk (retail, not barista)", category: "milk-alt", unit: "L", unitsPerPack: 1, packLabel: "1 L carton", pricePerPack: 2.2, notes: "Does not foam well for latte art" },
  { sku: "MT-CREAM-HEAVY-1", supplierId: "metro", name: "Heavy Whipping Cream", category: "milk", unit: "L", unitsPerPack: 1, packLabel: "1 L carton", pricePerPack: 6.4 },
  { sku: "DD-CREAM-HEAVY-2", supplierId: "dairydirect", name: "Heavy Whipping Cream", category: "milk", unit: "L", unitsPerPack: 2, packLabel: "2 L carton", pricePerPack: 10.9 },

  // Cups, lids, packaging
  { sku: "GC-CUP-HOT-12-1000", supplierId: "greencup", name: "Compostable Hot Cup 12 oz", category: "cups", unit: "unit", unitsPerPack: 1000, packLabel: "case of 1,000", pricePerPack: 78 },
  { sku: "GC-CUP-HOT-8-1000", supplierId: "greencup", name: "Compostable Hot Cup 8 oz", category: "cups", unit: "unit", unitsPerPack: 1000, packLabel: "case of 1,000", pricePerPack: 64 },
  { sku: "GC-CUP-HOT-16-1000", supplierId: "greencup", name: "Compostable Hot Cup 16 oz", category: "cups", unit: "unit", unitsPerPack: 1000, packLabel: "case of 1,000", pricePerPack: 92 },
  { sku: "GC-LID-HOT-1000", supplierId: "greencup", name: "Compostable Hot Lid (fits 8–16 oz)", category: "lids", unit: "unit", unitsPerPack: 1000, packLabel: "case of 1,000", pricePerPack: 41 },
  { sku: "GC-CUP-COLD-16-1000", supplierId: "greencup", name: "PLA Cold Cup 16 oz", category: "cups", unit: "unit", unitsPerPack: 1000, packLabel: "case of 1,000", pricePerPack: 88 },
  { sku: "GC-SLEEVE-1000", supplierId: "greencup", name: "Kraft Cup Sleeve", category: "packaging", unit: "unit", unitsPerPack: 1000, packLabel: "case of 1,000", pricePerPack: 36 },
  { sku: "GC-STRAW-PAPER-2000", supplierId: "greencup", name: "Paper Straw", category: "packaging", unit: "unit", unitsPerPack: 2000, packLabel: "case of 2,000", pricePerPack: 29 },
  { sku: "MT-CUP-HOT-12-500", supplierId: "metro", name: "Paper Hot Cup 12 oz (PE-lined)", category: "cups", unit: "unit", unitsPerPack: 500, packLabel: "pack of 500", pricePerPack: 31, notes: "Not compostable" },
  { sku: "MT-LID-HOT-500", supplierId: "metro", name: "Plastic Hot Lid", category: "lids", unit: "unit", unitsPerPack: 500, packLabel: "pack of 500", pricePerPack: 14 },
  { sku: "MT-NAPKIN-6000", supplierId: "metro", name: "Recycled Napkins", category: "packaging", unit: "unit", unitsPerPack: 6000, packLabel: "case of 6,000", pricePerPack: 48 },
  { sku: "GC-NAPKIN-4000", supplierId: "greencup", name: "Unbleached Napkins", category: "packaging", unit: "unit", unitsPerPack: 4000, packLabel: "case of 4,000", pricePerPack: 39 },

  // Syrups, sweeteners
  { sku: "SS-VANILLA-750", supplierId: "sweetsyrup", name: "Vanilla Syrup", category: "syrup", unit: "L", unitsPerPack: 0.75, packLabel: "750 ml bottle", pricePerPack: 7.9 },
  { sku: "SS-CARAMEL-750", supplierId: "sweetsyrup", name: "Caramel Syrup", category: "syrup", unit: "L", unitsPerPack: 0.75, packLabel: "750 ml bottle", pricePerPack: 7.9 },
  { sku: "SS-HAZELNUT-750", supplierId: "sweetsyrup", name: "Hazelnut Syrup", category: "syrup", unit: "L", unitsPerPack: 0.75, packLabel: "750 ml bottle", pricePerPack: 7.9 },
  { sku: "SS-VANILLA-SF-750", supplierId: "sweetsyrup", name: "Sugar-Free Vanilla Syrup", category: "syrup", unit: "L", unitsPerPack: 0.75, packLabel: "750 ml bottle", pricePerPack: 8.6 },
  { sku: "SS-MIXED-6x750", supplierId: "sweetsyrup", name: "Syrup Variety Case (2 vanilla, 2 caramel, 2 hazelnut)", category: "syrup", unit: "L", unitsPerPack: 4.5, packLabel: "case of 6 × 750 ml", pricePerPack: 41 },
  { sku: "MT-VANILLA-1000", supplierId: "metro", name: "Vanilla Syrup", category: "syrup", unit: "L", unitsPerPack: 1, packLabel: "1 L bottle", pricePerPack: 9.5 },
  { sku: "SS-CHOC-SAUCE-1900", supplierId: "sweetsyrup", name: "Chocolate Sauce", category: "syrup", unit: "L", unitsPerPack: 1.9, packLabel: "1.9 L jug", pricePerPack: 15.5 },
  { sku: "MT-SUGAR-PACKETS-2000", supplierId: "metro", name: "Sugar Packets", category: "sweetener", unit: "unit", unitsPerPack: 2000, packLabel: "case of 2,000", pricePerPack: 22 },
  { sku: "MT-RAW-SUGAR-PACKETS-1000", supplierId: "metro", name: "Raw Cane Sugar Packets", category: "sweetener", unit: "unit", unitsPerPack: 1000, packLabel: "case of 1,000", pricePerPack: 17 },

  // Tea & other drinks
  { sku: "MT-CHAI-CONC-946", supplierId: "metro", name: "Chai Tea Concentrate", category: "tea", unit: "L", unitsPerPack: 0.946, packLabel: "946 ml carton", pricePerPack: 5.4 },
  { sku: "SS-CHAI-CONC-6x946", supplierId: "sweetsyrup", name: "Chai Tea Concentrate", category: "tea", unit: "L", unitsPerPack: 5.676, packLabel: "case of 6 × 946 ml", pricePerPack: 27 },
  { sku: "MT-MATCHA-500G", supplierId: "metro", name: "Culinary Matcha Powder", category: "tea", unit: "kg", unitsPerPack: 0.5, packLabel: "500 g bag", pricePerPack: 24 },
  { sku: "SS-COCOA-1KG", supplierId: "sweetsyrup", name: "Hot Chocolate Powder", category: "cocoa", unit: "kg", unitsPerPack: 1, packLabel: "1 kg tin", pricePerPack: 14.5 },

  // Bakery
  { sku: "BH-CROISSANT-FROZEN-60", supplierId: "bakehouse", name: "Butter Croissant, frozen bake-off", category: "bakery", unit: "unit", unitsPerPack: 60, packLabel: "case of 60", pricePerPack: 48 },
  { sku: "BH-MUFFIN-BLUEB-24", supplierId: "bakehouse", name: "Blueberry Muffin, frozen", category: "bakery", unit: "unit", unitsPerPack: 24, packLabel: "case of 24", pricePerPack: 26 },
  { sku: "BH-COOKIE-CHOC-48", supplierId: "bakehouse", name: "Chocolate Chip Cookie Dough Pucks", category: "bakery", unit: "unit", unitsPerPack: 48, packLabel: "case of 48", pricePerPack: 21 },
  { sku: "MT-CROISSANT-12", supplierId: "metro", name: "Butter Croissant, ready to eat", category: "bakery", unit: "unit", unitsPerPack: 12, packLabel: "pack of 12", pricePerPack: 13.5 },

  // Cleaning
  { sku: "MT-ESPRESSO-CLEANER-900G", supplierId: "metro", name: "Espresso Machine Cleaning Powder", category: "cleaning", unit: "kg", unitsPerPack: 0.9, packLabel: "900 g tub", pricePerPack: 18 },
  { sku: "RL-CAFIZA-TABS-100", supplierId: "roastline", name: "Group Head Cleaning Tablets", category: "cleaning", unit: "unit", unitsPerPack: 100, packLabel: "tub of 100", pricePerPack: 16 },
];

export const supplierById = new Map(SUPPLIERS.map((s) => [s.id, s]));
export const productBySku = new Map(PRODUCTS.map((p) => [p.sku, p]));

/** Compact text rendering of the catalog for the model's context. */
export function catalogForPrompt(): string {
  const suppliers = SUPPLIERS.map(
    (s) =>
      `${s.id} | ${s.name} | delivery ${s.deliveryDays}d | min order $${s.minOrderUsd} | rating ${s.rating}`,
  ).join("\n");
  const products = PRODUCTS.map(
    (p) =>
      `${p.sku} | ${p.supplierId} | ${p.name} | ${p.category} | ${p.packLabel} = ${p.unitsPerPack} ${p.unit} | $${p.pricePerPack.toFixed(2)}/pack${p.notes ? ` | note: ${p.notes}` : ""}`,
  ).join("\n");
  return `SUPPLIERS (id | name | delivery | minimum order | rating)\n${suppliers}\n\nPRODUCTS (sku | supplier | name | category | pack = quantity in canonical unit | price)\n${products}`;
}
