/** Digits only. WhatsApp `wa_id` is already digits; display numbers often have `+` and spaces. */
export function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function samePhone(a: unknown, b: unknown): boolean {
  const da = digits(a);
  const db = digits(b);
  return da.length > 0 && da === db;
}
