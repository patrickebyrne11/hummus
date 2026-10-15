import { Stockwise } from "@/components/Stockwise";

// Original Stockwise flow (free-form list -> Claude deals -> Stripe Checkout). Needs ANTHROPIC_API_KEY.
export default function StockwisePage() {
  return <Stockwise />;
}
