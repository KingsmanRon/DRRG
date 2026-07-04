export function normalisePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return /^0\d{9}$/.test(digits) ? `27${digits.slice(1)}` : digits;
}
