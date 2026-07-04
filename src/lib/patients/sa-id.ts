export function isValidSouthAfricanId(value: string): boolean {
  const id = value.replace(/\s/g, "");
  if (!/^\d{13}$/.test(id)) return false;

  const digits = id.split("").map(Number);
  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8] + digits[10];
  const evenNumber = Number(`${digits[1]}${digits[3]}${digits[5]}${digits[7]}${digits[9]}${digits[11]}`);
  const evenSum = String(evenNumber * 2)
    .split("")
    .reduce((sum, digit) => sum + Number(digit), 0);
  const checkDigit = (10 - ((oddSum + evenSum) % 10)) % 10;

  return checkDigit === digits[12];
}
