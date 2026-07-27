import { describe, expect, it } from "vitest";
import { formatDate, formatPhone, initials, resultSummary } from "./format";

describe("formatDate", () => {
  it("renders the spec's reference date", () => {
    expect(formatDate("1994-12-29")).toBe("29 Dec 1994");
  });

  it("does not zero-pad the day", () => {
    expect(formatDate("1974-03-03")).toBe("3 Mar 1974");
  });

  it("abbreviates September to three letters, unlike en-ZA's 'Sept'", () => {
    expect(formatDate("1995-09-09")).toBe("9 Sep 1995");
  });

  it("never emits ISO or slash formats", () => {
    for (const iso of ["1994-12-29", "2015-07-19", "2001-01-01"]) {
      const shown = formatDate(iso);
      expect(shown).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(shown).not.toContain("/");
    }
  });

  it("tolerates a timestamp suffix", () => {
    expect(formatDate("1994-12-29T00:00:00Z")).toBe("29 Dec 1994");
  });

  it("returns empty for null or blank", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
  });

  it("returns unparseable input unchanged rather than 'Invalid Date'", () => {
    expect(formatDate("not a date")).toBe("not a date");
    expect(formatDate("1994-13-29")).toBe("1994-13-29");
  });
});

describe("formatPhone", () => {
  it("groups a mobile number as 3-3-4", () => {
    expect(formatPhone("0839274199")).toBe("083 927 4199");
  });

  it("groups a landline the same way", () => {
    expect(formatPhone("0165922072")).toBe("016 592 2072");
  });

  it("normalises +27 to the national leading-zero form", () => {
    expect(formatPhone("+27 82 123 4567")).toBe("082 123 4567");
    expect(formatPhone("27821234567")).toBe("082 123 4567");
  });

  it("strips existing punctuation before grouping", () => {
    expect(formatPhone("083-927-4199")).toBe("083 927 4199");
    expect(formatPhone("(083) 927 4199")).toBe("083 927 4199");
  });

  it("leaves numbers it does not recognise alone", () => {
    expect(formatPhone("12345")).toBe("12345");
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });

  it("returns empty for null or blank", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
  });
});

describe("initials", () => {
  it("takes the first letter of each name, uppercased", () => {
    expect(initials("Neo", "Phale")).toBe("NP");
    expect(initials("thandi grace", "mokoena")).toBe("TM");
  });

  it("survives a missing surname", () => {
    expect(initials("Neo", "")).toBe("N");
  });
});

describe("resultSummary", () => {
  it("reads 'across' for several files", () => {
    expect(resultSummary(6, 3)).toBe("6 patients across 3 files");
  });

  it("reads 'in' for a single file", () => {
    expect(resultSummary(3, 1)).toBe("3 patients in 1 file");
  });

  it("singularises one patient", () => {
    expect(resultSummary(1, 1)).toBe("1 patient in 1 file");
  });
});
