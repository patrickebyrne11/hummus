import type { InventoryItem } from "@/lib/schemas";

// Shortage bands, as a share of par. Worked out from the numbers, not by the model.
const SEVERE_AT = 0.15;
const LOW_AT = 0.35;

export function shortageOf(onHand: number | null, par: number | null, flaggedUrgent: boolean): InventoryItem["shortage"] {
  if (onHand != null && onHand <= 0) return "out";
  if (onHand != null && par != null && par > 0) {
    const share = Math.round((onHand / par) * 1000) / 1000;
    if (share <= SEVERE_AT) return "severe";
    if (share <= LOW_AT) return flaggedUrgent ? "severe" : "low";
  }
  return flaggedUrgent ? "severe" : null;
}
