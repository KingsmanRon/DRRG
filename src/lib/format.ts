/**
 * Display formatting shared by the register and the patient page.
 *
 * These live in one place deliberately: the two screens previously formatted
 * dates differently, so the same patient's date of birth read as `1994-12-29`
 * on one screen and `29/12/1994` on the other.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * ISO date (`1994-12-29`) to `29 Dec 1994`.
 *
 * Deliberately a fixed table rather than Intl: `en-ZA` renders September as
 * "Sept" and zero-pads the day ("09 Sept 1995"), which contradicts the format
 * this app displays everywhere else, and ICU output shifts between Node
 * versions. A table is stable and locale-independent by construction.
 *
 * Returns the input unchanged if it is not an ISO date, so a bad value shows
 * as itself rather than "Invalid Date" or an empty cell.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value;

  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return value;

  // Day is not zero-padded: "3 Mar 1974", not "03 Mar 1974".
  return `${Number(day)} ${monthName} ${year}`;
}

/**
 * South African phone number to `083 927 4199` / `016 592 2072`.
 *
 * Accepts anything staff have typed over the years — `+27 82 123 4567`,
 * `082-123-4567`, `0821234567` — and normalises to the national
 * leading-zero form before grouping. Non-SA and malformed numbers are
 * returned as given rather than mangled into a shape they do not have.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (!digits) return value;

  // +27 82 123 4567 -> 082 123 4567
  const national = digits.startsWith("27") && digits.length === 11
    ? `0${digits.slice(2)}`
    : digits;

  if (national.length !== 10 || !national.startsWith("0")) return value;
  return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

/** First letter of first name + first letter of surname, uppercased. */
export function initials(firstNames: string, surname: string): string {
  const first = firstNames.trim()[0] ?? "";
  const last = surname.trim()[0] ?? "";
  return `${first}${last}`.toUpperCase();
}

/** "6 patients across 3 files" / "3 patients in 1 file" / "1 patient in 1 file". */
export function resultSummary(patientCount: number, fileCount: number): string {
  const patients = `${patientCount} ${patientCount === 1 ? "patient" : "patients"}`;
  if (fileCount === 1) return `${patients} in 1 file`;
  return `${patients} across ${fileCount} files`;
}
