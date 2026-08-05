function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Today as yyyy-mm-dd in the reader's own calendar, not UTC's. */
function localIsoDate(date: Date): string {
  return isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * The date of birth an ID number carries in its first six digits (YYMMDD), or
 * null when it carries none that can be read.
 *
 * **The century is not in the number.** `240315` is either 2024 or 1924 and the
 * check digit cannot tell them apart, so this returns the most recent date that
 * is not in the future — right for everyone except patients over about a
 * hundred, which is why the form shows the derived date and lets it be
 * overridden rather than filling a hidden field.
 *
 * Only a valid ID is read: a half-typed or mistyped number derives nothing,
 * so a wrong date of birth cannot appear while the ID is still being entered.
 */
export function dateOfBirthFromSouthAfricanId(value: string, today: Date = new Date()): string | null {
  const id = value.replace(/\s/g, "");
  if (!isValidSouthAfricanId(id)) return null;

  const year = Number(id.slice(0, 2));
  const month = Number(id.slice(2, 4));
  const day = Number(id.slice(4, 6));
  const todayIso = localIsoDate(today);

  for (const century of [2000, 1900]) {
    if (!isRealDate(century + year, month, day)) continue;
    const candidate = isoDate(century + year, month, day);
    // Same format either side, so a string comparison is a date comparison.
    if (candidate <= todayIso) return candidate;
  }
  // Some legacy numbers carry a date that never existed (a 31st of February,
  // or 000000). There is nothing to derive; the form asks for it instead.
  return null;
}

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
