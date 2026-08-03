import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PatientEditForm, type PatientRecord } from "./patient-edit-form";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, replace() {} }) }));

function patient(over: Partial<PatientRecord> = {}): PatientRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    file_number: "2014",
    first_names: "Boitumelo",
    surname: "Phale",
    date_of_birth: "1995-09-09",
    identity_type: "none",
    identity_number: null,
    identity_country: null,
    no_identity_reason_code: "not_brought",
    no_identity_note: null,
    ask_identity_again: true,
    phone: "073 111 2222",
    email: null,
    residential_address: "1410\nZone 13\nSebokeng",
    postal_code: "1983",
    no_contact_reason: null,
    status: "active",
    ...over,
  };
}

function render(record: PatientRecord) {
  return renderToStaticMarkup(<PatientEditForm patient={record} />);
}

describe("postal code on the patient form", () => {
  it("is offered as its own field, below the address", () => {
    const html = render(patient());
    expect(html).toContain('for="postal_code"');
    expect(html.indexOf('id="residential_address"')).toBeLessThan(html.indexOf('id="postal_code"'));
  });

  it("says it is optional, and is not marked required", () => {
    const html = render(patient());
    const label = html.slice(html.indexOf('for="postal_code"'), html.indexOf('id="postal_code"'));
    expect(label).toContain("(optional)");
    expect(label).not.toContain("required");
  });

  it("loads the postal code already on file", () => {
    expect(render(patient())).toContain('value="1983"');
  });

  it("comes up empty when the patient has no postal code", () => {
    const html = render(patient({ postal_code: null }));
    expect(html).toContain('id="postal_code"');
    expect(html).not.toContain('value="1983"');
  });

  it("takes four digits from a numeric keypad", () => {
    const field = render(patient()).match(/<input id="postal_code"[^>]*>/)?.[0] ?? "";
    expect(field).toContain('maxLength="4"');
    expect(field).toContain('inputMode="numeric"');
  });

  it("keeps the address in its own box", () => {
    // The address must not carry the code: that is what stopped two files for
    // one household from matching.
    const html = render(patient());
    expect(html).toContain("1410\nZone 13\nSebokeng");
    expect(html).not.toContain("Sebokeng\n1983");
  });
});
