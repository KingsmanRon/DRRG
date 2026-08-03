import { describe, expect, it } from "vitest";
import {
  addressWithoutPostalCode,
  isValidPostalCode,
  postalCodeFromAddress,
  splitPostalCode,
} from "./address";

// These cases mirror scripts/db-test/tests/020_backfill.sql. The database is
// what actually splits the stored addresses; this locks the same rule in the
// language the UI is written in.
describe("postalCodeFromAddress", () => {
  it("lifts a code off the last line of an address", () => {
    expect(postalCodeFromAddress("1410\nZone 13\nSebokeng\n1983")).toBe("1983");
  });

  it("lifts a code off the end of a single line address", () => {
    expect(postalCodeFromAddress("1410 Zone 13 Sebokeng 1983")).toBe("1983");
  });

  it("accepts a code after a comma", () => {
    expect(postalCodeFromAddress("12 Long Street, Vereeniging, 1930")).toBe("1930");
  });

  it("sees past trailing blank lines", () => {
    expect(postalCodeFromAddress("12 Long Street\nVereeniging\n1930\n\n  ")).toBe("1930");
  });

  it("finds nothing when the address has no code", () => {
    expect(postalCodeFromAddress("1410\nZone 13\nSebokeng")).toBeNull();
  });

  it("leaves a five digit stand number alone", () => {
    // 17234 is a whole address in parts of the register. Reading it as ...7234
    // would invent a postal code and destroy the stand number.
    expect(postalCodeFromAddress("17234")).toBeNull();
  });

  it("leaves an address that is only four digits alone", () => {
    expect(postalCodeFromAddress("1983")).toBeNull();
  });

  it("leaves an all-numeric address alone", () => {
    // "stand 1410, code 1983" and "two stand numbers" are the same characters.
    expect(postalCodeFromAddress("1410 1983")).toBeNull();
  });

  it("ignores digits glued to a word", () => {
    expect(postalCodeFromAddress("12 Long Street Ext1983")).toBeNull();
  });

  it("ignores tails that are not four digits", () => {
    expect(postalCodeFromAddress("12 Long Street 193")).toBeNull();
    expect(postalCodeFromAddress("12 Long Street 193045")).toBeNull();
  });

  it("handles no address at all", () => {
    expect(postalCodeFromAddress(null)).toBeNull();
    expect(postalCodeFromAddress("")).toBeNull();
  });
});

describe("addressWithoutPostalCode", () => {
  it("keeps the address line for line", () => {
    expect(addressWithoutPostalCode("1410\nZone 13\nSebokeng\n1983")).toBe("1410\nZone 13\nSebokeng");
  });

  it("keeps a street and a town", () => {
    expect(addressWithoutPostalCode("No 50 Frikkie Meyer Boulevard\nVanderbijlpark\n1911")).toBe(
      "No 50 Frikkie Meyer Boulevard\nVanderbijlpark",
    );
  });

  it("returns an address with no code exactly as entered", () => {
    expect(addressWithoutPostalCode("1410\nZone 13\nSebokeng")).toBe("1410\nZone 13\nSebokeng");
  });

  it("is idempotent — running it again removes nothing more", () => {
    const once = String(addressWithoutPostalCode("1410\nZone 13\nSebokeng\n1983"));
    expect(addressWithoutPostalCode(once)).toBe(once);
  });

  it("splits both halves at once", () => {
    expect(splitPostalCode("1410 Zone 13 Sebokeng 1983")).toEqual({
      address: "1410 Zone 13 Sebokeng",
      postal_code: "1983",
    });
  });
});

describe("isValidPostalCode", () => {
  it("treats blank as valid, because the field is optional", () => {
    expect(isValidPostalCode("")).toBe(true);
  });

  it("accepts four digits", () => {
    expect(isValidPostalCode("1983")).toBe(true);
    expect(isValidPostalCode("0083")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidPostalCode("198")).toBe(false);
    expect(isValidPostalCode("19834")).toBe(false);
    expect(isValidPostalCode("ABCD")).toBe(false);
    expect(isValidPostalCode("19 8")).toBe(false);
  });
});
