import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DuplicateResolver, type DuplicateReview } from "./duplicate-resolver";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

type Side = DuplicateReview["patient"];

function side(over: Partial<Side> & { id: string; file_number: string }): Side {
  return {
    first_names: "Boitumelo",
    surname: "Phale",
    date_of_birth: "1995-09-09",
    identity_type: "none",
    identity_last4: null,
    phone: "073 111 2222",
    email: null,
    residential_address: "1410 Zone 13 Sebokeng",
    postal_code: null,
    status: "active",
    ...over,
  };
}

// The pair this change exists for: same name, same address, one day apart, and
// only the older file has the postal code.
const boitumelo: DuplicateReview = {
  review_id: "99999999-9999-4999-8999-999999999999",
  reviewed_at: "2026-08-03T09:00:00.000Z",
  review_reason: "Patient says she has never been here before.",
  match_score: 4,
  match_tier: "possible",
  match_reasons: ["name", "address"],
  identity_match: false,
  patient: side({ id: "a", file_number: "1450", date_of_birth: "1995-09-10", phone: "079 444 5555" }),
  candidate: side({ id: "b", file_number: "2014", postal_code: "1983" }),
};

function render(reviews: DuplicateReview[]) {
  return renderToStaticMarkup(<DuplicateResolver reviews={reviews} />);
}

describe("the duplicate review screen", () => {
  it("shows the postal code as its own row, not folded into the address", () => {
    const html = render([boitumelo]);
    expect(html).toContain('>Postal code<span class="dupRowState');
    expect(html).toContain("1410 Zone 13 Sebokeng");
    expect(html.indexOf(">Address")).toBeLessThan(html.indexOf(">Postal code"));
  });

  it("shows which file has the code and which has none", () => {
    const html = render([boitumelo]);
    expect(html).toContain('>Postal code<span class="dupRowState dupStateMissing">');
    expect(html.slice(html.indexOf(">Postal code"))).toContain("1983");
  });

  it("leaves the row out when neither file has a postal code", () => {
    const html = render([
      { ...boitumelo, candidate: side({ id: "b", file_number: "2014" }) },
    ]);
    expect(html).not.toContain("Postal code");
  });

  it("still reports the address as matching, code or no code", () => {
    // One file was captured with the code inside the address box. Both texts
    // stay on screen, but the verdict agrees with the score above them.
    const html = render([
      {
        ...boitumelo,
        candidate: side({
          id: "b",
          file_number: "2014",
          residential_address: "1410 Zone 13 Sebokeng 1983",
        }),
      },
    ]);
    expect(html).toContain('>Address<span class="dupRowState dupStateMatch">');
    expect(html).toContain("1410 Zone 13 Sebokeng 1983");
  });

  it("leads with the tier and the reasons the pair was flagged", () => {
    expect(render([boitumelo])).toContain("Possible duplicate — same name and address");
  });

  it("does not hide the one-day difference in date of birth", () => {
    const html = render([boitumelo]);
    expect(html).toContain("1995-09-09");
    expect(html).toContain("1995-09-10");
    expect(html).toContain('>Date of birth<span class="dupRowState dupStateDiffer">');
  });

  it("offers a decision rather than merging anything", () => {
    const html = render([boitumelo]);
    expect(html).toContain("Merge — keep file A");
    expect(html).toContain("Merge — keep file B");
    expect(html).toContain("Not the same person — keep both files");
  });
});
