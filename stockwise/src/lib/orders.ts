import { productBySku, supplierById, type Product, type Supplier } from "@/lib/catalog";

export interface OrderLine {
  product: Product;
  packs: number;
  total: number;
}

export interface SupplierOrder {
  supplier: Supplier;
  lines: OrderLine[];
  subtotal: number;
}

/** Demo orders travel in the URL as "SKU*packs~SKU*packs" so no storage is needed. */
export function encodeDemoOrder(lines: { sku: string; packs: number }[]) {
  return lines.map((l) => `${l.sku}*${l.packs}`).join("~");
}

export function decodeDemoOrder(encoded: string): OrderLine[] {
  return encoded
    .split("~")
    .map((part) => {
      const [sku, packsText] = part.split("*");
      const product = productBySku.get(sku);
      const packs = Number(packsText);
      if (!product || !Number.isInteger(packs) || packs < 1 || packs > 500) return null;
      return { product, packs, total: Math.round(packs * product.pricePerPack * 100) / 100 };
    })
    .filter((l): l is OrderLine => l !== null);
}

export function groupBySupplier(lines: OrderLine[]): SupplierOrder[] {
  const map = new Map<string, SupplierOrder>();
  for (const line of lines) {
    const supplier = supplierById.get(line.product.supplierId)!;
    const group = map.get(supplier.id) ?? { supplier, lines: [], subtotal: 0 };
    group.lines.push(line);
    group.subtotal = Math.round((group.subtotal + line.total) * 100) / 100;
    map.set(supplier.id, group);
  }
  return [...map.values()];
}
