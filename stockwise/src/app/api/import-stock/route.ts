import * as XLSX from "xlsx";
import { z } from "zod";
import { UserFacingError, errorResponse, structuredCall } from "@/lib/claude";

// Stock sheet -> BeanCounter stock levels. Claude maps the owner's rows (any layout) onto the
// agent's stock items; the Python API then holds the new quantities and the agent runs as usual.

const API = process.env.BEANCOUNTER_API ?? "http://127.0.0.1:8000";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const MappingSchema = z.object({
  updates: z.array(
    z.object({
      item_id: z.string(),
      on_hand: z.number(),
      source_row: z.string(),
      assumption: z.string().nullable(),
    }),
  ),
  unmatched: z.array(z.string()),
});

type StockItem = { id: string; name: string; qty: number };

const SYSTEM = `You read a coffee shop owner's stock-count sheet and map it onto the shop's tracked stock items.

For each row that matches a tracked item, return its id and the quantity ON HAND, converted to that item's unit
(the unit is in the item name, e.g. "Oat milk (L)" is litres, "12oz cups (x50)" counts sleeves of 50, "Croissants (x12)" counts boxes of 12).
Round to a whole number. If a conversion or match is a guess, say so in "assumption".
Rows that don't match any tracked item go in "unmatched" (short label). Headers and totals are ignored.`;

export async function POST(request: Request) {
  try {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserFacingError("Choose a stock sheet to upload.");
    if (file.size > MAX_FILE_BYTES) throw new UserFacingError("File is larger than 5 MB.");

    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })).join("\n\n");

    const stock: StockItem[] = (await (await fetch(`${API}/state`)).json()).stock;
    const tracked = stock.map((s) => `- ${s.id}: ${s.name} (currently ${s.qty})`).join("\n");

    const mapping = await structuredCall({
      schema: MappingSchema,
      system: SYSTEM,
      user: `<tracked_items>\n${tracked}\n</tracked_items>\n\n<stock_sheet>\n${sheet}\n</stock_sheet>`,
      effort: "low",
    });

    const known = new Set(stock.map((s) => s.id));
    const applied = mapping.updates.filter((u) => known.has(u.item_id));
    if (applied.length === 0) throw new UserFacingError("None of the rows matched a tracked stock item.", 422);

    let state: unknown = null;
    for (const u of applied) {
      const res = await fetch(`${API}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: u.item_id, qty: Math.max(0, Math.round(u.on_hand)) }),
      });
      if (!res.ok) throw new UserFacingError(`BeanCounter API rejected ${u.item_id} (${res.status}).`, 502);
      state = await res.json();
    }

    return Response.json({ updates: applied, unmatched: mapping.unmatched, state });
  } catch (err) {
    return errorResponse(err);
  }
}
