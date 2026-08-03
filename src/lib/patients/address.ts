/**
 * Addresses and the postal codes that used to be buried in them.
 *
 * Mirrors `private.postal_code_from_address`, `private.address_without_postal_code`
 * and `private.address_match_key` in
 * supabase/migrations/20260803120000_postal_code_separation.sql — the database
 * is the source of truth for production decisions; this exists so the rules can
 * be unit tested and so the UI can describe them. Keep the two in sync.
 */

/** A four digit token at the end, standing on its own rather than glued to a word. */
const TRAILING_CODE = /(?:^|[\s,;])\d{4}$/;
const TRAILING_CODE_WITH_SEPARATORS = /[\s,;]*\d{4}$/;

/**
 * The postal code at the end of an address, but only when lifting it out is
 * unambiguous: something must be left behind, and what is left must contain a
 * letter. "17234" and "1410 1983" are stand numbers as readily as postal codes,
 * so they are left alone — under-extracting keeps the address working, while
 * over-extracting quietly destroys part of it.
 */
export function postalCodeFromAddress(value: string | null | undefined): string | null {
  const address = (value ?? "").trim();
  if (!TRAILING_CODE.test(address)) return null;

  const remainder = address.replace(TRAILING_CODE_WITH_SEPARATORS, "").trimEnd();
  if (remainder === "" || !/[A-Za-z]/.test(remainder)) return null;

  return address.slice(-4);
}

/**
 * The address with that trailing code removed. Anything the rule above does not
 * recognise comes back exactly as it was entered — line breaks, capitalisation
 * and punctuation included.
 */
export function addressWithoutPostalCode<T extends string | null | undefined>(value: T): T | string {
  if (postalCodeFromAddress(value) === null) return value;
  return (value ?? "").trim().replace(TRAILING_CODE_WITH_SEPARATORS, "").trimEnd();
}

/** Both halves at once, for splitting a pasted address. */
export function splitPostalCode(value: string): { address: string; postal_code: string | null } {
  const postal_code = postalCodeFromAddress(value);
  return { address: String(addressWithoutPostalCode(value) ?? ""), postal_code };
}

export const POSTAL_CODE_PATTERN = /^[0-9]{4}$/;

/** Four digits, or nothing at all. Postal code is never required. */
export function isValidPostalCode(value: string): boolean {
  return value === "" || POSTAL_CODE_PATTERN.test(value);
}
