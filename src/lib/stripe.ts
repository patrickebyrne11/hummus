import Stripe from "stripe";
import { UserFacingError } from "@/lib/claude";

let stripe: Stripe | null = null;

/** Stripe client restricted to test mode — this prototype must never move real money. */
export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new UserFacingError(
      "STRIPE_SECRET_KEY is not set. Add a test-mode key (sk_test_…) to .env.local.",
      500,
    );
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new UserFacingError("Only Stripe test-mode keys are allowed in this prototype.", 500);
  }
  stripe ??= new Stripe(key);
  return stripe;
}
