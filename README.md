# Stockwise

An AI purchasing agent for independent cafés. Bob (a coffee shop owner) gives it his stock list, the agent finds the best wholesale deals, Bob reviews them, and nothing is bought until he approves and pays.

## Flow

1. **Your stock**: Bob types a free-form list or uploads an `.xlsx` / `.xls` / `.csv` / `.ods` sheet in any layout.
2. **Check the list**: Claude (`/api/parse`) extracts what to buy, normalises units (kg / L / unit), works out *par − on hand*, and flags its assumptions. Bob can edit quantities or remove items.
3. **Review deals**: Claude (`/api/deals`) picks up to three suitable catalog products per item and recommends one. The **server** computes pack counts, totals and savings from the catalog, so prices never come from the model. Bob can switch options, untick items, and see supplier-minimum warnings.
4. **Approve & pay**: `/api/checkout` creates a Stripe Checkout session (**test-mode keys only**; live keys are refused). `/orders` shows the paid order split into one purchase order per supplier.

The supplier catalog is mock data in `src/lib/catalog.ts`. Model output is never stubbed: without an API key, the routes return a clear error.

## Setup

```bash
cp .env.example .env.local   # add ANTHROPIC_API_KEY and a Stripe sk_test_ key
npm install
npm run dev
```

Pay with the Stripe test card `4242 4242 4242 4242`, any future expiry date, and any CVC. `public/sample-inventory.xlsx` is a deliberately messy stock-count sheet you can use for testing.
