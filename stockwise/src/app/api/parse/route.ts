import * as XLSX from "xlsx";
import { ParsedInventorySchema, type InventoryItem } from "@/lib/schemas";
import { UserFacingError, errorResponse, structuredCall } from "@/lib/claude";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;

// Shortage bands, as a share of par. Worked out here from the numbers, not by the model.
const SEVERE_AT = 0.15;
const LOW_AT = 0.35;

function shortageOf(onHand: number | null, par: number | null, flaggedUrgent: boolean): InventoryItem["shortage"] {
  if (onHand != null && onHand <= 0) return "out";
  if (onHand != null && par != null && par > 0) {
    const share = Math.round((onHand / par) * 1000) / 1000;
    if (share <= SEVERE_AT) return "severe";
    if (share <= LOW_AT) return flaggedUrgent ? "severe" : "low";
  }
  return flaggedUrgent ? "severe" : null;
}

const RANK = { out: 0, severe: 1, low: 2 } as const;

const SYSTEM = `You turn a coffee shop owner's inventory or shopping list into structured purchase needs.

The input may be a typed list or CSV rendered from a spreadsheet, in any language and any layout. Columns may be missing, merged or oddly named.

For each purchasable stock item:
- quantity is the amount to BUY. If the sheet has both "on hand" and "par level"/"target", buy = target − on hand (skip the item if that's ≤ 0). If there is just one quantity, treat it as the amount to buy.
- Convert to one canonical unit: kg for solids sold by weight (g→kg, lb→kg ×0.4536), L for liquids (ml→L, gallon→L ×3.785, fl oz→L ×0.02957), unit for countable things (cups, lids, pastries, packets). If a case size is given ("3 cases of 1000 cups"), multiply out. If a case size is unknown, make a sensible assumption and say so.
- currentUnitPrice is the price per ONE canonical unit, converted accordingly (e.g. $45 per 2 kg bag → 22.5). null if no price is given.
- Put any conversion or guess in "assumption" as a short phrase.
- If the input gives stock on hand and a par/target level, copy both into onHand and par in the canonical unit. Otherwise leave them null.
- Set flaggedUrgent when the input says an item is out, nearly out, or urgent.

Put headers, totals, notes and non-stock rows (equipment repairs, wages, rent) in "skipped" with a short reason.`;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const text = form.get("text");

    let input: string;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) throw new UserFacingError("File is larger than 5 MB.");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      input = wb.SheetNames.map(
        (name) => `### Sheet: ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false })}`,
      ).join("\n\n");
    } else if (typeof text === "string" && text.trim()) {
      input = text;
    } else {
      throw new UserFacingError("Add some items or upload a spreadsheet.");
    }

    if (input.length > MAX_TEXT_CHARS) {
      throw new UserFacingError("That inventory is too large for one pass. Try fewer rows.", 413);
    }

    const parsed = await structuredCall({
      schema: ParsedInventorySchema,
      system: SYSTEM,
      user: `<inventory>\n${input}\n</inventory>`,
      effort: "low",
    });

    if (parsed.items.length === 0) {
      throw new UserFacingError("No purchasable stock items were found in that input.", 422);
    }
    // Most urgent first, so the shortage shows at the top of the list.
    const items: InventoryItem[] = parsed.items
      .map(({ flaggedUrgent, ...it }) => ({ ...it, shortage: shortageOf(it.onHand, it.par, flaggedUrgent) }))
      .map((it, i) => ({ it, i }))
      .sort((a, b) => (a.it.shortage ? RANK[a.it.shortage] : 3) - (b.it.shortage ? RANK[b.it.shortage] : 3) || a.i - b.i)
      .map(({ it }) => it);
    return Response.json({ items, skipped: parsed.skipped });
  } catch (err) {
    return errorResponse(err);
  }
}
