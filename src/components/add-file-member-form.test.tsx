import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AddFileMemberForm, type FileContext } from "./add-file-member-form";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function fileContext(over: Partial<FileContext> = {}): FileContext {
  return {
    file_number: "DRRG00000042",
    members: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        first_names: "Nomsa",
        surname: "Dlamini",
        date_of_birth: "1984-03-03",
      },
    ],
    phone: "083 400 0001",
    residential_address: "12 Zone 3\nSebokeng",
    postal_code: "1983",
    no_contact_reason: "",
    consent_signed_by: "Nomsa Dlamini",
    ...over,
  };
}

function render(over: Partial<FileContext> = {}) {
  return renderToStaticMarkup(<AddFileMemberForm fileContext={fileContext(over)} />);
}

describe("adding a person to a file", () => {
  it("asks for the name and the ID, and nothing else by default", () => {
    const markup = render();
    expect(markup).toContain('id="first_names"');
    expect(markup).toContain('id="surname"');
    expect(markup).toContain('id="identity_number"');
    // One screen, not four steps.
    expect(markup).not.toContain("Onboarding progress");
  });

  it("does not ask for consent again", () => {
    const markup = render();
    expect(markup).not.toContain('id="signature_value"');
    expect(markup).not.toContain("patient is present");
    expect(markup).toContain("Covered by the consent Nomsa Dlamini signed for this file.");
  });

  it("states the file's contact details instead of asking for them", () => {
    const markup = render();
    expect(markup).toContain("083 400 0001");
    expect(markup).toContain("12 Zone 3, Sebokeng");
    expect(markup).toContain("1983");
    // The fields exist only behind the override.
    expect(markup).not.toContain('id="residential_address"');
    expect(markup).toContain("contact details are different");
  });

  it("offers the date of birth as something the ID will answer", () => {
    const markup = render();
    expect(markup).toContain("Date of birth");
    expect(markup).toContain("Filled in as soon as the ID number is complete.");
  });

  it("names who is already on the file", () => {
    const markup = render();
    expect(markup).toContain("DRRG00000042");
    expect(markup).toContain("Nomsa Dlamini");
  });

  it("says so when the file itself has no contact details", () => {
    const markup = render({
      phone: "",
      residential_address: "",
      postal_code: "",
      no_contact_reason: "Treated on the day with no phone or fixed address",
    });
    expect(markup).toContain("No contact details on file");
  });

  it("falls back to a plain statement when the signatory cannot be read", () => {
    const markup = render({ consent_signed_by: "" });
    expect(markup).toContain("Covered by the consent already signed for this file.");
  });
});
