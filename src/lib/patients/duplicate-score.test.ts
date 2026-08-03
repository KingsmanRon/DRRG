import { describe, expect, it } from "vitest";
import {
  addressMatchKey,
  matchBanner,
  pairMatchFingerprint,
  scorePair,
  type MatchSide,
} from "./duplicate-score";

const base: MatchSide = {
  first_names: "Thabo",
  surname: "Nkosi",
  date_of_birth: "1990-06-21",
  phone: "071 987 6543",
  email: "thabo@example.com",
  residential_address: "3 Long Street, Durban",
};

function side(overrides: Partial<MatchSide>): MatchSide {
  return { ...base, ...overrides };
}

const unrelated: MatchSide = {
  first_names: "Lerato",
  surname: "Khumalo",
  date_of_birth: "1995-09-30",
  phone: "083 777 1234",
  email: null,
  residential_address: "5 Church Street, Polokwane",
};

describe("scorePair", () => {
  it("identity number match is decisive: always Likely", () => {
    const result = scorePair(unrelated, side({ email: null }), true);
    expect(result.tier).toBe("likely");
    expect(result.reasons).toContain("identity number");
  });

  it("name + date of birth is Likely even with nothing else matching", () => {
    const result = scorePair(
      base,
      side({ phone: "082 000 0000", email: null, residential_address: "9 Other Road, Pretoria" }),
    );
    expect(result.tier).toBe("likely");
    expect(result.score).toBe(6);
    expect(result.reasons).toEqual(["name", "date of birth"]);
  });

  it("phone + address only is Possible, never Likely", () => {
    const result = scorePair(
      side({ first_names: "Ayanda", surname: "Zulu", date_of_birth: "1985-02-14", email: null }),
      side({ first_names: "Andile", surname: "Zulu", date_of_birth: "1988-08-08", email: null }),
    );
    expect(result.score).toBe(2);
    expect(result.tier).toBe("possible");
    expect(result.reasons).toEqual(["phone", "address"]);
  });

  it("a single field alone is never flagged", () => {
    const phoneOnly = scorePair(base, { ...unrelated, phone: base.phone });
    expect(phoneOnly.score).toBe(1);
    expect(phoneOnly.tier).toBe("none");

    const addressOnly = scorePair(base, {
      ...unrelated,
      residential_address: base.residential_address,
    });
    expect(addressOnly.tier).toBe("none");

    // A lone date-of-birth or email match would flag every patient born on
    // the same day / sharing a family address book entry.
    const dobOnly = scorePair(base, { ...unrelated, date_of_birth: base.date_of_birth });
    expect(dobOnly.score).toBe(3);
    expect(dobOnly.tier).toBe("none");

    const emailOnly = scorePair(base, { ...unrelated, email: "THABO@example.com " });
    expect(emailOnly.score).toBe(2);
    expect(emailOnly.tier).toBe("none");
  });

  it("email + one weak field flags as possible", () => {
    const result = scorePair(base, {
      ...unrelated,
      email: "thabo@example.com",
      phone: base.phone,
    });
    expect(result.score).toBe(3);
    expect(result.tier).toBe("possible");
    expect(result.reasons).toEqual(["email", "phone"]);
  });

  it("normalises case, whitespace and diacritics in names", () => {
    const result = scorePair(
      side({ first_names: "José-Maria", email: null }),
      side({ first_names: "jose maria", phone: "082 000 0000", email: null, residential_address: "Elsewhere 1" }),
    );
    expect(result.reasons).toContain("name");
    expect(result.tier).toBe("likely");
  });

  it("normalises local and international phone formats", () => {
    const result = scorePair(
      side({ phone: "082 111 2222", date_of_birth: "1970-01-01", first_names: "A", email: null }),
      side({ phone: "+27 82 111 2222", date_of_birth: "1971-01-01", first_names: "B", email: null }),
    );
    expect(result.reasons).toContain("phone");
  });

  it("missing emails never count as a match", () => {
    const result = scorePair(side({ email: null }), { ...unrelated, email: null });
    expect(result.reasons).not.toContain("email");
  });
});

describe("addressMatchKey", () => {
  it("ignores line breaks and spacing", () => {
    expect(addressMatchKey("1410\nZone13\nSebokeng")).toBe(addressMatchKey("1410 Zone 13 Sebokeng"));
  });

  it("ignores case, punctuation and accents", () => {
    expect(addressMatchKey("1410, ZONE 13; Sébokeng.")).toBe(addressMatchKey("1410 zone 13 sebokeng"));
  });

  it("ignores a postal code on one side only", () => {
    expect(addressMatchKey("1410 Zone 13 Sebokeng\n1983")).toBe(addressMatchKey("1410 Zone 13 Sebokeng"));
  });

  it("still tells two addresses apart", () => {
    expect(addressMatchKey("1410 Zone 13 Sebokeng")).not.toBe(addressMatchKey("1411 Zone 13 Sebokeng"));
    expect(addressMatchKey("1410 Zone 13 Sebokeng\n1983")).not.toBe(
      addressMatchKey("1410 Zone 14 Sebokeng\n1983"),
    );
  });
});

describe("the Boitumelo Phale pair", () => {
  // Two files for what looks like one person: same name, same address, dates of
  // birth a day apart, different phones, no email. The address on the older
  // file carried the postal code; the newer one did not, which is the only
  // reason this pair was never flagged.
  const older: MatchSide = {
    first_names: "Boitumelo",
    surname: "Phale",
    date_of_birth: "1995-09-09",
    phone: "073 111 2222",
    email: null,
    residential_address: "1410\nZone 13\nSebokeng\n1983",
  };
  const newer: MatchSide = {
    first_names: "Boitumelo",
    surname: "Phale",
    date_of_birth: "1995-09-10",
    phone: "079 444 5555",
    email: null,
    residential_address: "1410\nZone 13\nSebokeng",
  };

  it("is a possible duplicate on name and address alone", () => {
    const result = scorePair(older, newer);
    expect(result.score).toBe(4);
    expect(result.tier).toBe("possible");
    expect(result.reasons).toEqual(["name", "address"]);
  });

  it("is put in front of a person rather than merged", () => {
    // "Possible" is the tier that asks for a decision; it never blocks or
    // merges on its own, and the one-day difference stays visible.
    expect(matchBanner(scorePair(older, newer))).toBe("Possible duplicate — same name and address");
    expect(older.date_of_birth).not.toBe(newer.date_of_birth);
  });

  it("does not depend on the postal code being on file", () => {
    const bothWithout = scorePair(
      { ...older, residential_address: "1410 Zone 13 Sebokeng" },
      newer,
    );
    expect(bothWithout.score).toBe(scorePair(older, newer).score);
  });

  it("still matches once the code is moved out of the address", () => {
    const split = scorePair(
      { ...older, residential_address: "1410\nZone 13\nSebokeng" },
      newer,
    );
    expect(split.tier).toBe("possible");
    expect(split.reasons).toEqual(["name", "address"]);
  });

  it("counts moving the code out as a change to the stored address", () => {
    // The fingerprint follows the stored text, so it does notice the rewrite.
    // That is why the migration re-baselines the pairs it rewrote — otherwise
    // every dismissed pair would re-open the next time either file was edited.
    expect(pairMatchFingerprint(
      { ...older, identity_type: "none" },
      { ...newer, identity_type: "none" },
    )).not.toBe(pairMatchFingerprint(
      { ...older, residential_address: "1410\nZone 13\nSebokeng", identity_type: "none" },
      { ...newer, identity_type: "none" },
    ));
  });
});

describe("matchBanner", () => {
  it("leads with the tier and reasons", () => {
    expect(matchBanner(scorePair(base, side({ phone: "082 000 0000", email: null })))).toBe(
      "Likely duplicate — same name, date of birth and address",
    );
  });

  it("labels weak matches as possible", () => {
    const result = scorePair(
      side({ first_names: "Ayanda", surname: "Zulu", date_of_birth: "1985-02-14", email: null }),
      side({ first_names: "Andile", surname: "Zulu", date_of_birth: "1988-08-08", email: null }),
    );
    expect(matchBanner(result)).toBe("Possible duplicate — same phone and address");
  });
});

describe("pairMatchFingerprint (keep-both dismissals)", () => {
  const a = { ...base, identity_type: "sa_id", identity_number: "9006213456088" };
  const b = {
    ...side({ phone: "071 000 1111", email: null }),
    identity_type: "none",
    identity_number: null,
  };

  it("is stable while the matched fields stay unchanged, so a dismissed pair stays dismissed", () => {
    const atDismissal = pairMatchFingerprint(a, b);
    const later = pairMatchFingerprint({ ...a }, { ...b });
    expect(later).toBe(atDismissal);
  });

  it("is order-insensitive", () => {
    expect(pairMatchFingerprint(a, b)).toBe(pairMatchFingerprint(b, a));
  });

  it("changes when a matched field changes, so the dismissed pair is re-evaluated", () => {
    const atDismissal = pairMatchFingerprint(a, b);
    const afterPhoneChange = pairMatchFingerprint(a, { ...b, phone: "072 999 8888" });
    expect(afterPhoneChange).not.toBe(atDismissal);
  });

  it("ignores formatting-only changes", () => {
    const atDismissal = pairMatchFingerprint(a, b);
    const reformatted = pairMatchFingerprint(a, { ...b, phone: "+27 71 000 1111" });
    expect(reformatted).toBe(atDismissal);
  });
});
