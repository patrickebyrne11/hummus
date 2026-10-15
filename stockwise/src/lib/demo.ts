// Demo mode: deterministic, rule-based stand-ins for the Claude calls, so the full journey
// can be clicked through with no API key and no Claude Code sign-in (e.g. a shared preview
// deployment). Opt-in with CLAUDE_BACKEND=demo. Results are flagged as demo in the UI and
// are much cruder than the real model.

import { PRODUCTS, type CanonicalUnit, type Product } from "@/lib/catalog";
import type { DealsResult, InventoryItem } from "@/lib/schemas";
import { shortageOf } from "@/lib/shortage";

// Opt-in only: with no API key the app's default backend is the local Claude Code CLI.
export const isDemo = () => process.env.CLAUDE_BACKEND === "demo";

// ---------- Parsing ----------

const KG_WORDS = ["bean", "coffee", "espresso", "decaf", "matcha", "cocoa", "chocolate powder", "powder", "flour"];
const L_WORDS = ["milk", "syrup", "sauce", "chai", "cream", "cold brew", "concentrate", "juice"];

function defaultUnit(name: string): CanonicalUnit {
  const n = name.toLowerCase();
  if (/cup|lid|napkin|straw|sleeve|croissant|muffin|cookie|packet|tablet/.test(n)) return "unit";
  if (L_WORDS.some((w) => n.includes(w))) return "L";
  if (KG_WORDS.some((w) => n.includes(w))) return "kg";
  return "unit";
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const toNum = (s: string) => Number(s.replace(",", "."));

/** Parse a single free-text line into a purchase need. Returns a string when the line is skipped. */
function parseLine(raw: string): InventoryItem | string | null {
  // Strip list markers ("-", "•", "1.", "2)") but not leading sizes like "12oz".
  let line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "");
  if (!line) return null;
  if (/^(total|subtotal|notes?)\b/i.test(line) || /repair|rent|wages|salary|replacement/i.test(line)) {
    return `${line}: not a stock item`;
  }

  // Price first, so its number isn't mistaken for a quantity.
  let price: { amount: number; per: string } | null = null;
  const priceMatch = line.match(new RegExp(String.raw`\$\s?${NUM}\s*(?:\/|per|a|each)?\s*([a-z]+(?:\s+(?:of\s+)?\d+\s*(?:ml)?)?)?`, "i"));
  if (priceMatch) {
    price = { amount: toNum(priceMatch[1]), per: (priceMatch[2] ?? "").trim().toLowerCase() };
    line = line.replace(priceMatch[0], " ");
  }
  // Stock position: "4 kg left, par 20 kg", "1 bottle left (750 ml), par 6", "out".
  const stock = takeStockPosition(line);
  line = stock.rest;

  // "…from BeanCo" names the current supplier, not part of the item.
  let currentSupplier: string | null = null;
  const from = line.match(/\bfrom\s+([A-Za-z][\w&' ]*?)\s*(?=[,;(]|$)/);
  if (from) {
    currentSupplier = from[1].trim();
    line = line.replace(from[0], " ");
  }
  line = line.replace(/\b(at|paying|we pay|currently)\b/gi, " ");

  let quantity: number | null = null;
  let unit: CanonicalUnit | null = null;
  let assumption: string | null = null;
  let caseSize: number | null = null;

  const unitPatterns: [RegExp, (m: RegExpMatchArray) => [number, CanonicalUnit]][] = [
    [new RegExp(String.raw`${NUM}\s*cases?\s*(?:of|x|×)\s*${NUM}`, "i"), (m) => {
      caseSize = toNum(m[2]);
      return [toNum(m[1]) * caseSize, "unit"];
    }],
    [new RegExp(String.raw`${NUM}\s*(?:bottles?|cartons?|jugs?)\s*\(?\s*${NUM}\s*ml\)?`, "i"), (m) => [(toNum(m[1]) * toNum(m[2])) / 1000, "L"]],
    [new RegExp(String.raw`${NUM}\s*(?:kg|kilos?|kilograms?)\b`, "i"), (m) => [toNum(m[1]), "kg"]],
    [new RegExp(String.raw`${NUM}\s*g\b`, "i"), (m) => [toNum(m[1]) / 1000, "kg"]],
    [new RegExp(String.raw`${NUM}\s*(?:lbs?|pounds?)\b`, "i"), (m) => [toNum(m[1]) * 0.4536, "kg"]],
    [new RegExp(String.raw`${NUM}\s*(?:l|litres?|liters?|ltr)\b`, "i"), (m) => [toNum(m[1]), "L"]],
    [new RegExp(String.raw`${NUM}\s*ml\b`, "i"), (m) => [toNum(m[1]) / 1000, "L"]],
    [new RegExp(String.raw`${NUM}\s*(?:gal|gallons?)\b`, "i"), (m) => [toNum(m[1]) * 3.785, "L"]],
  ];
  for (const [re, fn] of unitPatterns) {
    const m = line.match(re);
    if (m) {
      [quantity, unit] = fn(m);
      line = line.replace(m[0], " ");
      break;
    }
  }

  if (quantity === null) {
    const caseOnly = line.match(new RegExp(String.raw`${NUM}\s*cases?\b`, "i"));
    const plain = line.match(new RegExp(String.raw`(?:x\s*)?\b${NUM}\b(?!\s*oz)`, "i"));
    if (caseOnly) {
      quantity = toNum(caseOnly[1]);
      line = line.replace(caseOnly[0], " ");
      assumption = "a case means one of the supplier's standard case sizes";
    } else if (plain) {
      quantity = toNum(plain[1]);
      line = line.replace(plain[0], " ");
    }
  }

  const name = line
    .replace(/[(),:–—-]+/g, " ")
    .replace(/\b(for the week|per week|weekly|pcs|pieces|units?|x)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
  if (!name) return null;

  unit ??= stock.unit ?? defaultUnit(name);
  let onHand: number | null = null;
  let par: number | null = null;
  if (stock.found) {
    onHand = stock.onHand;
    par = stock.par;
    if (onHand != null && par != null) {
      if (par - onHand <= 0) return `${name}: already at or above par level`;
      quantity = par - onHand;
    }
  }
  if (quantity === null) {
    quantity = 1;
    assumption = stock.found && onHand === 0 ? "out, no par level given, so pricing one pack" : "no quantity given, so pricing one pack";
  }

  let currentUnitPrice: number | null = null;
  if (price) {
    const caseOf = price.per.match(/case\s*(?:of)?\s*(\d+)/);
    const ml = price.per.match(/(\d+)\s*ml/);
    if (caseOf) currentUnitPrice = price.amount / Number(caseOf[1]);
    else if (/case/.test(price.per) && caseSize) currentUnitPrice = price.amount / caseSize;
    else if (ml) currentUnitPrice = price.amount / (Number(ml[1]) / 1000);
    else if (/bottle/.test(price.per)) currentUnitPrice = price.amount / 0.75;
    else currentUnitPrice = price.amount;
    currentUnitPrice = Math.round(currentUnitPrice * 10000) / 10000;
  }

  return {
    name,
    quantity: Math.round(quantity * 1000) / 1000,
    unit,
    currentUnitPrice,
    currentSupplier,
    assumption,
    onHand,
    par,
    shortage: shortageOf(onHand, par, false),
  };
}

function toCanonical(n: number, word: string | undefined, containerMl: number | null): { n: number; unit: CanonicalUnit | null } {
  const w = (word ?? "").toLowerCase();
  if (containerMl) return { n: (n * containerMl) / 1000, unit: "L" };
  if (/^(kg|kilos?|kilograms?)$/.test(w)) return { n, unit: "kg" };
  if (w === "g") return { n: n / 1000, unit: "kg" };
  if (/^(lbs?|pounds?)$/.test(w)) return { n: n * 0.4536, unit: "kg" };
  if (/^(l|litres?|liters?|ltr)$/.test(w)) return { n, unit: "L" };
  if (w === "ml") return { n: n / 1000, unit: "L" };
  if (/^(gal|gallons?)$/.test(w)) return { n: n * 3.785, unit: "L" };
  return { n, unit: null };
}

/** Pulls "X left", "par Y" and "out" out of a line, converting to canonical units. */
function takeStockPosition(line: string) {
  let rest = line;
  let onHand: number | null = null;
  let par: number | null = null;
  let unit: CanonicalUnit | null = null;
  let containerMl: number | null = null;
  let found = false;

  const left = rest.match(new RegExp(String.raw`${NUM}\s*([a-z]+)?\s*(?:left|on hand|in stock)\s*(?:\(\s*${NUM}\s*ml\s*\))?`, "i"));
  if (left) {
    found = true;
    const word = left[2] && !/^(left|on)$/i.test(left[2]) ? left[2] : undefined;
    containerMl = left[3] ? toNum(left[3]) : /bottle/i.test(word ?? "") ? 750 : null;
    const c = toCanonical(toNum(left[1]), word, containerMl);
    onHand = c.n;
    unit = c.unit;
    rest = rest.replace(left[0], " ");
  }
  const parM = rest.match(new RegExp(String.raw`\bpar(?:\s+level)?\s*:?\s*${NUM}\s*([a-z]+)?`, "i"));
  if (parM) {
    found = true;
    const c = toCanonical(toNum(parM[1]), parM[2], parM[2] ? null : containerMl);
    par = c.n;
    unit ??= c.unit;
    rest = rest.replace(parM[0], " ");
  }
  if (onHand === null && /\b(out|none left|run out|ran out)\b/i.test(rest)) {
    found = true;
    onHand = 0;
    rest = rest.replace(/\b(out|none left|run out|ran out)\b/i, " ");
  }
  return { found, onHand, par, unit, rest };
}

export function demoParseText(text: string) {
  const items: InventoryItem[] = [];
  const skipped: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const r = parseLine(line);
    if (typeof r === "string") skipped.push(r);
    else if (r) items.push(r);
  }
  return { items, skipped };
}

/** Spreadsheet rows → lines the text parser understands (handles on-hand/par-level sheets). */
export function demoParseRows(rows: unknown[][]) {
  const cells = rows.map((r) => r.map((c) => String(c ?? "").trim()));
  const headerIdx = cells.findIndex((r) => r.some((c) => /^(item|product|name|description)/i.test(c)));
  if (headerIdx === -1) return demoParseText(cells.map((r) => r.join(" ")).join("\n"));

  const header = cells[headerIdx].map((h) => h.toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const c = {
    name: col(/item|product|name|description/),
    onHand: col(/on hand|in stock|current|have/),
    par: col(/par|target|max|need/),
    qty: col(/^qty|quantity|order|amount/),
    unit: col(/unit|uom/),
    price: col(/price|cost/),
    supplier: col(/supplier|vendor/),
  };

  const items: InventoryItem[] = [];
  const skipped: string[] = [];
  for (const r of cells.slice(headerIdx + 1)) {
    const name = r[c.name];
    if (!name) continue;
    let qty: number | null = null;
    if (c.par >= 0 && r[c.par] !== "") {
      qty = Number(r[c.par]) - (c.onHand >= 0 ? Number(r[c.onHand] || 0) : 0);
      if (!(qty > 0)) {
        if (r[c.par]) skipped.push(`${name}: already at or above par level`);
        continue;
      }
    } else if (c.qty >= 0 && r[c.qty] !== "") qty = Number(r[c.qty]);

    const unitText = c.unit >= 0 ? r[c.unit] : "";
    const qtyText = qty === null ? "" : /bottle|carton|ml|kg|\bl\b|lb|g\b/i.test(unitText) ? `${qty} ${unitText}` : `${qty}`;
    const line = [name, qtyText, c.price >= 0 && r[c.price] ? `at ${r[c.price]}` : ""].join(" ");
    const parsed = parseLine(line);
    if (typeof parsed === "string") skipped.push(parsed);
    else if (parsed) {
      if (c.supplier >= 0 && r[c.supplier]) parsed.currentSupplier = r[c.supplier];
      items.push(parsed);
    }
  }
  return { items, skipped };
}

// ---------- Deal matching ----------

const EXCLUSIVE_GROUPS = [
  ["oat", "almond", "soy", "whole", "skim", "cream"],
  ["vanilla", "caramel", "hazelnut", "chocolate", "variety"],
  ["hot", "cold"],
  ["8", "12", "16"],
  ["croissant", "muffin", "cookie"],
  ["cup", "lid", "sleeve", "straw", "napkin", "packet"],
  ["chai", "matcha", "cocoa"],
];
const FLAGS = ["decaf", "sugar-free", "barista", "compostable", "raw"];
const STOP = new Set(["the", "of", "a", "and", "for", "with", "fits", "edition", "oz", "ready", "to", "eat"]);

function tokens(s: string) {
  return s
    .toLowerCase()
    .replace(/\(.*?not \w+.*?\)/g, " ") // "(retail, not barista)" shouldn't count as barista
    .replace(/(\d+)\s*oz/g, "$1 oz")
    .replace(/[^a-z0-9-]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

function fits(itemT: string[], prodT: string[]) {
  for (const g of EXCLUSIVE_GROUPS) {
    const a = g.filter((w) => itemT.includes(w));
    const b = g.filter((w) => prodT.includes(w));
    // The product may not bring in a variant the item didn't ask for (e.g. a mixed-flavour case for "vanilla").
    if (a.length && b.some((w) => !a.includes(w))) return false;
  }
  for (const f of ["decaf", "sugar-free"]) if (prodT.includes(f) !== itemT.includes(f)) return false;
  return true;
}

export function demoDeals(items: InventoryItem[]): DealsResult {
  const out: DealsResult["items"] = items.map((item, itemIndex) => {
    const it = tokens(item.name);
    const scored = PRODUCTS.filter((p) => p.unit === item.unit)
      .map((p) => {
        const pt = tokens(`${p.name} ${p.category}`);
        if (!fits(it, pt)) return null;
        const score = it.filter((t) => pt.includes(t)).length;
        return score > 0 ? { p, pt, score, total: Math.ceil(item.quantity / p.unitsPerPack - 1e-9) * p.pricePerPack } : null;
      })
      .filter((x): x is { p: Product; pt: string[]; score: number; total: number } => x !== null);

    if (!scored.length) {
      return { itemIndex, options: [], recommendedSku: null, note: "Nothing in the supplier catalog matches this item." };
    }
    const best = Math.max(...scored.map((s) => s.score));
    const candidates = scored.filter((s) => s.score >= Math.max(1, Math.ceil(best * 0.6)));
    const top = candidates.filter((s) => s.score === best).sort((a, b) => a.total - b.total)[0];
    const rest = candidates.filter((s) => s !== top).sort((a, b) => a.total - b.total).slice(0, 2);
    const cheapest = Math.min(...candidates.map((s) => s.total));

    const why = (s: (typeof candidates)[number], isTop: boolean) => {
      const parts: string[] = [];
      const missing = FLAGS.filter((f) => it.includes(f) && !s.pt.includes(f));
      if (isTop) parts.push(s.total === cheapest ? "Closest match and the lowest total price" : "Closest match to what you asked for");
      else if (missing.length) parts.push(`Cheaper, but not ${missing.join(" or ")}`);
      else parts.push(s.total < top.total ? "Cheaper, but a looser match" : "A solid alternative that costs a bit more");
      if (item.currentUnitPrice != null) {
        const save = item.currentUnitPrice * item.quantity - s.total;
        if (save > 0.5) parts.push(`saves about $${save.toFixed(0)} versus today`);
      }
      const over = Math.ceil(item.quantity / s.p.unitsPerPack - 1e-9) * s.p.unitsPerPack - item.quantity;
      if (over > item.quantity * 0.25) parts.push(`the pack size means you'll over-buy ${+over.toFixed(2)} ${item.unit}`);
      if (s.p.notes) parts.push(s.p.notes.toLowerCase());
      return parts.join("; ") + ".";
    };

    return {
      itemIndex,
      options: [top, ...rest].map((s, i) => ({ sku: s.p.sku, why: why(s, i === 0) })),
      recommendedSku: top.p.sku,
      note: null,
    };
  });

  const matched = out.filter((o) => o.recommendedSku).length;
  const suppliers = new Set(
    out.flatMap((o) => (o.recommendedSku ? [PRODUCTS.find((p) => p.sku === o.recommendedSku)!.supplierId] : [])),
  );
  return {
    items: out,
    summary: `I matched ${matched} of ${items.length} items across ${suppliers.size} supplier${suppliers.size === 1 ? "" : "s"}, preferring the closest match and then the lowest total price. This is demo matching, so check the picks carefully.`,
  };
}
