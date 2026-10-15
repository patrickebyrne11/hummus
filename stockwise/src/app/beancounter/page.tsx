import { BeanCounter } from "@/components/BeanCounter";

// Autonomous restocking agent: policy guard, Stripe PaymentIntents, Cognee memory (Python API at /bc/*).
export default function BeanCounterPage() {
  return <BeanCounter />;
}
