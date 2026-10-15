# Stockwise: Engineering Overview

> **Status:** clickable prototype, last updated 2026-10-15
> **Repo path:** `stockwise/`
> **Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · Anthropic SDK (`claude-opus-5-5`) · Stripe (test mode only) · SheetJS

---

## 1. What we're building

Stockwise is an AI purchasing agent for small hospitality businesses. Our first persona is **Bob, an independent coffee shop owner**.

Bob spends hours every week working out what to restock and comparing supplier prices. Stockwise takes his stock list, finds him the best wholesale deals, and **buys only after Bob explicitly approves**.

### The user journey

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ 1. Input     │ → │ 2. Confirm   │ → │ 3. Review    │ → │ 4. Approve   │
│ type list or │   │ AI-parsed    │   │ AI-ranked    │   │ & pay        │
│ upload Excel │   │ items (edit) │   │ deals        │   │ (Stripe)     │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
                   human checkpoint    human checkpoint    human checkpoint
```

| Step | What Bob does | What the system does |
|---|---|---|
| 1. Input | Types a free-form list or uploads `.xlsx / .xls / .csv / .ods` | Reads the file server-side and converts every sheet to CSV |
| 2. Confirm | Edits quantities or removes items | Claude extracts the purchase needs, normalises units, computes *par − on hand*, and flags assumptions |
| 3. Review | Switches between options, unticks items | Claude matches each item to catalog SKUs (up to 3, one marked "Best deal"); the **server** computes all prices and savings |
| 4. Approve & pay | Clicks **Approve & buy** and pays on Stripe Checkout | Stripe test-mode session; the `/orders` page splits the paid order into one purchase order per supplier |

**Core product principle:** the agent never spends money without a human approval step, and every piece of AI reasoning is visible to Bob (the assumptions, the "why" for each option, the summary).

---

## 2. Architecture

```
Browser (client component)                 Next.js route handlers (server)
───────────────────────────                ─────────────────────────────────
src/components/Stockwise.tsx
  ├─ step 1 ──FormData──────────────────▶  POST /api/parse
  │                                          SheetJS → CSV → Claude (structured output)
  ├─ step 2 ──JSON {items}──────────────▶  POST /api/deals
  │                                          Claude picks SKUs → server prices from catalog
  ├─ step 3 ──JSON {lines:[sku,packs]}──▶  POST /api/checkout
  │                                          re-prices from catalog → Stripe Checkout Session
  └─ redirect to Stripe ──────────────────▶ Stripe ──▶ /orders?session_id=…
                                             server component retrieves session + line items
```

### File map

| Path | Purpose |
|---|---|
| `src/components/Stockwise.tsx` | The whole 4-step client UI: state, sessionStorage persistence, selection logic, totals |
| `src/app/api/parse/route.ts` | Spreadsheet/text → structured inventory (Claude, effort `low`) |
| `src/app/api/deals/route.ts` | Inventory → ranked deals (Claude, effort `medium`) + server-side pricing |
| `src/app/api/checkout/route.ts` | Approved lines → Stripe Checkout Session |
| `src/app/orders/page.tsx` | Post-payment purchase orders grouped by supplier (wrapped in `<Suspense>`, required by Next 16 prerendering) |
| `src/lib/claude.ts` | Anthropic client, `structuredCall()` helper, typed error → HTTP mapping |
| `src/lib/stripe.ts` | Stripe client with a **test-key-only guard** |
| `src/lib/catalog.ts` | Mock suppliers and products, plus `catalogForPrompt()` |
| `src/lib/schemas.ts` | Zod schemas shared by the model output and the API contracts |
| `public/sample-inventory.xlsx` | A deliberately messy stock-count sheet for testing |

---

## 3. AI design

### Model usage

Both AI calls go through `structuredCall()` in `src/lib/claude.ts`:

- **Model:** `claude-opus-5-5`
- **Structured outputs:** `client.beta.messages.parse` with `betaZodOutputFormat(schema)`. The response is validated against Zod, so there's no hand-written JSON parsing.
- **Refusal fallback:** `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`
- **Prompt caching:** the system prompt carries `cache_control: ephemeral`. The deals system prompt embeds the full catalog, so repeat calls hit the cache.
- **Effort:** `low` for parsing (mechanical), `medium` for deal matching (judgement)
- **Stop reasons handled:** `refusal` → 422, `max_tokens` → 413, unparseable output → 502

### Division of responsibility (important)

| The LLM decides | The server decides |
|---|---|
| What each row means and how much to buy | Pack count: `ceil(qty / unitsPerPack)` |
| Unit conversion (g→kg, gallons→L, cases→units) | Price per unit, line totals, savings |
| Which SKUs genuinely fit the item (barista vs. retail oat milk, compostable vs. PE-lined cups, cup size) | Whether a SKU exists and whether its unit matches the item (invalid picks are dropped) |
| Ranking, "why" text, notes, summary | Stripe line-item prices (re-derived from the catalog at checkout and never trusted from the client) |

**Rule: the model never produces a dollar figure that Bob pays.** If you add features, keep the money math deterministic.

### Budget

Bob chooses **No limit** (the default) or **Set a budget** for the whole order on the first screen, and can switch or change it on the deals screen.

- `/api/deals` takes `budget`. Claude is told to stay within it, and the server's `fitToBudget()` acts as a safety net: if the recommended picks still exceed it, it switches items to cheaper options (largest saving first) and says so in the item's note and the summary. If even the cheapest options don't fit, the summary says by how much.
- The deals screen shows a budget meter. **Approve is disabled while the order is over budget**, and if Bob changes the budget after the search, he's offered "Find deals for this budget".
- `/api/checkout` re-checks the total against `budget` server-side and refuses orders over it.

### Canonical units

Every item is normalised to `kg`, `L` or `unit`. Catalog products declare `unitsPerPack` in the same canonical unit, which keeps pricing a simple division. The parse prompt includes the conversion factors.

### Demo mode (no keys needed)

Set `CLAUDE_BACKEND=demo` to run in **demo mode**, so anyone can click through the full journey with no API key and no Claude Code sign-in (useful for a shared preview deployment):

| Step | Live (`api` or `claude-code` backend) | Demo mode (`CLAUDE_BACKEND=demo`) |
|---|---|---|
| Parse list | Claude structured output | Rule-based parser in `src/lib/demo.ts`: regex units/prices, par − on-hand for sheets |
| Find deals | Claude picks SKUs | Keyword matching with variant rules (size, milk type, flavour, decaf), then lowest total |
| Checkout | Stripe Checkout (test mode) | `/checkout/demo`: no card fields; the order is encoded in the URL |
| Orders | Read from the Stripe session | Rebuilt from the catalog using the URL |

The header badge shows **"Demo mode, sample matching"** whenever demo results are on screen, and the API responses carry `mode: "demo" | "ai"`. Without `STRIPE_SECRET_KEY`, checkout uses the demo screen even when Claude is live. Demo matching is much cruder than Claude; it exists for walkthroughs, not for judging extraction quality.

---

## 4. API contracts

### `POST /api/parse`

`multipart/form-data` with either `file` (≤ 5 MB) or `text` (≤ 60k chars after conversion).

```jsonc
// 200
{
  "items": [
    {
      "name": "Espresso beans (house)",
      "quantity": 16,               // amount to BUY, in canonical unit
      "unit": "kg",                 // "kg" | "L" | "unit"
      "currentUnitPrice": 24,       // per ONE canonical unit, or null
      "currentSupplier": "BeanCo",  // or null
      "assumption": null            // string when the model had to guess
    }
  ],
  "skipped": ["Grinder burr replacement: equipment repair, not stock"]
}
```

### `POST /api/deals`

Request: `{ "items": InventoryItem[] }` (1–150 items)

```jsonc
// 200
{
  "summary": "2–3 sentence plan for Bob",
  "deals": [
    {
      "item": { /* InventoryItem */ },
      "recommendedSku": "RL-ESP-HOUSE-5",
      "currentCost": 384.0,         // null if no current price known
      "note": null,
      "options": [
        {
          "sku": "RL-ESP-HOUSE-5", "productName": "...", "supplierId": "roastline",
          "supplierName": "Roastline Wholesale", "packLabel": "5 kg bag",
          "packs": 4, "unitsBought": 20, "unitPrice": 18.4, "total": 368,
          "deliveryDays": 2, "rating": 4.7, "why": "..."
        }
      ]
    }
  ]
}
```

### `POST /api/checkout`

Request: `{ "lines": [{ "sku": "RL-ESP-HOUSE-5", "packs": 4 }] }` (packs: int, 1–500)
Response: `{ "url": "https://checkout.stripe.com/..." }`

Every product's Stripe metadata carries `sku`, `supplierId` and `supplierName`. `/orders` uses these to group lines into purchase orders.

### Errors

Every route returns `{ "error": string }` with an appropriate status code. The UI shows the message as-is, so keep it human-readable.

---

## 5. Safety and guardrails already in place

- **Stripe live keys are rejected.** `getStripe()` throws unless the key starts with `sk_test_` or `rk_test_`.
- **Prices aren't trusted from the client.** Checkout re-derives every price from the catalog by SKU.
- **Unknown or hallucinated SKUs are dropped** before Bob sees them.
- **Upload limits:** 5 MB per file, 60k chars of extracted text, 150 items per deals call.
- **SheetJS** is installed from the official CDN tarball (`xlsx-0.20.3`), **not** npm's stale `0.18.5`, which has known CVEs.
- **Untrusted spreadsheet content** is wrapped in `<inventory>` tags. It only feeds a structured-output extraction call; there are no tools the model could be tricked into calling.

---

## 6. Local setup

```bash
cd stockwise
cp .env.example .env.local     # ANTHROPIC_API_KEY=…  STRIPE_SECRET_KEY=sk_test_…
npm install
npm run dev                    # http://localhost:3000 (or -p 3010 if Edventure is running)
```

Stripe test card: `4242 4242 4242 4242`, any future expiry date, any CVC.

Checks:

```bash
npm run build && npm run lint
```

---

## 7. Known gaps / not yet done

**Verified so far:** production build, lint, step-1 UI rendering, and the missing-key error path.
**Verified in demo mode:** the full journey (typed list and the sample .xlsx → deals → demo checkout → orders).
**Not yet verified:** the live Claude and Stripe paths (they need real keys).

| Area | Gap | Suggested direction |
|---|---|---|
| Supplier data | Static mock catalog (6 suppliers, ~45 SKUs) | Supplier API integrations or scraped price feeds; a catalog DB with price history |
| Scale | The whole catalog sits in the prompt | Switch to a tool-use agent (`search_catalog(query)`) or retrieval once the catalog exceeds a few hundred SKUs |
| Purchasing | Bob pays Stockwise via Stripe; no orders are actually sent to suppliers | Supplier ordering via API/EDI/email, Stripe Connect for payouts, order status webhooks |
| Persistence | None (sessionStorage only, so cancelled checkouts can be restored) | Accounts, saved inventories, order history, recurring par levels |
| Payments | The `/orders` page reads the Stripe session on load | Add a `checkout.session.completed` webhook as the source of truth |
| Minimum orders | Warning only, purchase not blocked | Decide on the product rule: block, or let the agent auto-consolidate |
| Long lists | One model call per step | Chunk lists over ~150 items; stream progress to the UI |
| Evals | None | Build an eval set of real, messy café spreadsheets (multilingual, odd units, merged cells) to measure parse accuracy and deal quality |
| Auth / multi-tenant | None | Required before any real business data goes in |

---

## 8. Conventions

- Next.js 16 has breaking changes compared with older versions. Read `node_modules/next/dist/docs/` before using unfamiliar APIs (see `AGENTS.md`).
- Use the SDKs' typed errors (`Anthropic.RateLimitError`, etc.); never string-match error messages.
- Shared shapes live in `src/lib/schemas.ts` as Zod schemas. Derive TypeScript types from them rather than duplicating them.
- Design tokens (light mode; one ember→orchid→glacier gradient used only on non-text elements, plus corner mesh glows) are CSS variables in `src/app/globals.css`, exposed to Tailwind via `@theme inline`.
