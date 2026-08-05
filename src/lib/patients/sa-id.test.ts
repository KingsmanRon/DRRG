import { describe, expect, it } from "vitest";
import { dateOfBirthFromSouthAfricanId, isValidSouthAfricanId } from "./sa-id";

/** Fixed "today" so the century rule is testable rather than time-dependent. */
const today = new Date(2026, 7, 5);

describe("dateOfBirthFromSouthAfricanId", () => {
  it("reads the date of birth out of the first six digits", () => {
    expect(dateOfBirthFromSouthAfricanId("0503155009080", today)).toBe("2005-03-15");
  });

  it("ignores spaces, the way the number is written on a card", () => {
    expect(dateOfBirthFromSouthAfricanId("050315 5009 080", today)).toBe("2005-03-15");
  });

  it("falls back a century when this century would be in the future", () => {
    // 2080-01-01 has not happened, so 80 means 1980.
    expect(dateOfBirthFromSouthAfricanId("8001015009087", today)).toBe("1980-01-01");
    expect(dateOfBirthFromSouthAfricanId("9901015009087", today)).toBe("1999-01-01");
  });

  it("takes the most recent plausible century for an ambiguous number", () => {
    // 24 is 2024 or 1924 and the number cannot say which. A two-year-old is the
    // overwhelmingly likelier patient, and the form shows this for correction.
    expect(dateOfBirthFromSouthAfricanId("2403155009081", today)).toBe("2024-03-15");
  });

  it("does not derive a date later today's year cannot reach", () => {
    // 26 December 2026 is still ahead of the fixed today, so 1926 it is.
    expect(dateOfBirthFromSouthAfricanId("2612275009082", today)).toBe("1926-12-27");
  });

  it("keeps a leap day that only exists in one of the two centuries", () => {
    // 2000 was a leap year; 1900 was not.
    expect(dateOfBirthFromSouthAfricanId("0002295009084", today)).toBe("2000-02-29");
  });

  it("derives nothing from a date that never existed", () => {
    // Month 31, day 32 — a valid check digit does not make a valid date.
    expect(dateOfBirthFromSouthAfricanId("9931325009089", today)).toBeNull();
  });

  it("derives nothing while the number is still being typed", () => {
    expect(dateOfBirthFromSouthAfricanId("050315", today)).toBeNull();
    expect(dateOfBirthFromSouthAfricanId("", today)).toBeNull();
  });

  it("derives nothing from a number that fails the check digit", () => {
    expect(isValidSouthAfricanId("0503155009081")).toBe(false);
    expect(dateOfBirthFromSouthAfricanId("0503155009081", today)).toBeNull();
  });
});
