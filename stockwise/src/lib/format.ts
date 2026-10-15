export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const usdPrecise = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 3 });

export const qty = (n: number, unit: string) =>
  `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit === "unit" ? (n === 1 ? "unit" : "units") : unit}`;
