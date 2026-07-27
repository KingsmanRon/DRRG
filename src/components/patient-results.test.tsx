import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { groupByFile } from "@/lib/patients/file-groups";
import { PatientResults, type RegisterPatient } from "./patient-results";

// next/link needs the Next router context; an <a> is all this markup check needs.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function patient(over: Partial<RegisterPatient> & { id: string; file_number: string }): RegisterPatient {
  return {
    first_names: "A",
    surname: "B",
    date_of_birth: "1990-01-01",
    identity_type: "sa_id",
    identity_last4: "1234",
    phone: null,
    status: "active",
    ...over,
  };
}

/** File 2014 holding three people, as in the brief. */
const household = [
  patient({ id: "1", file_number: "2014", first_names: "Neo", surname: "Phale", date_of_birth: "1994-12-29", phone: "0839274199" }),
  patient({ id: "2", file_number: "2014", first_names: "Kabelo", surname: "Phale", date_of_birth: "1995-09-09", phone: "0839274199" }),
  patient({ id: "3", file_number: "2014", first_names: "Lesedi", surname: "Phale", date_of_birth: "2019-05-02", phone: "0839274199", identity_type: "none", identity_last4: null }),
];

function render(patients: RegisterPatient[], query = "") {
  return renderToStaticMarkup(
    <PatientResults groups={groupByFile(patients)} query={query} totalPatients={patients.length} />,
  );
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("register results", () => {
  it("shows the file number exactly once for a three-patient file", () => {
    // The whole point: a repeated identifier reads as a duplicate record.
    expect(occurrences(render(household, "2014"), "File 2014")).toBe(1);
  });

  it("shows the shared phone number exactly once per file", () => {
    expect(occurrences(render(household, "2014"), "083 927 4199")).toBe(1);
  });

  it("nests all three patients under the one file", () => {
    const html = render(household, "2014");
    for (const name of ["Neo Phale", "Kabelo Phale", "Lesedi Phale"]) {
      expect(html).toContain(name);
    }
  });

  it("renders no Cash patient chip", () => {
    expect(render(household, "2014")).not.toContain("Cash patient");
  });

  it("renders dates as 29 Dec 1994, never ISO", () => {
    const html = render(household, "2014");
    expect(html).toContain("29 Dec 1994");
    expect(html).toContain("9 Sep 1995");
    expect(html).not.toContain("1994-12-29");
  });

  it("shows no computed age anywhere", () => {
    const html = render(household, "2014");
    expect(html).not.toMatch(/\d+\s*(years|yrs|yo)\b/i);
  });

  it("gives the file header a real button reporting its expanded state", () => {
    const html = render(household, "2014");
    expect(html).toMatch(/<button[^>]+aria-expanded="true"/);
    expect(html).toMatch(/aria-controls="/);
  });

  it("expands a file the query named by number", () => {
    expect(render(household, "2014")).toMatch(/aria-expanded="true"/);
  });

  it("collapses multi-patient files when browsing with no query", () => {
    const mixed = [...household, patient({ id: "4", file_number: "1877" }), patient({ id: "5", file_number: "1901" })];
    expect(render(mixed, "")).toMatch(/aria-expanded="false"/);
  });

  it("renders a single-patient file flat, with no expander", () => {
    const solo = [patient({ id: "9", file_number: "1877", first_names: "Miriam", surname: "Sithole", date_of_birth: "1974-03-03" })];
    const html = render(solo, "sithole");
    expect(html).not.toContain("<button");
    // The file number moves inline into the patient's meta line instead.
    expect(html).toContain("3 Mar 1974 · File 1877");
  });

  it("marks a missing identity document in text, not colour alone", () => {
    expect(render(household, "2014")).toContain("No ID");
  });

  it("summarises the result set above the cards", () => {
    const mixed = [...household, patient({ id: "4", file_number: "1877" }), patient({ id: "5", file_number: "1901" })];
    const html = render(mixed, "phale");
    expect(html).toContain("5 patients across 3 files");
    expect(html).toContain('aria-live="polite"');
  });

  it("says 'in 1 file' when a single file matches", () => {
    expect(render(household, "2014")).toContain("3 patients in 1 file");
  });

  it("invites action when nothing matches", () => {
    const html = render([], "2014");
    expect(html).toContain("No patients match");
    expect(html).toContain("Check the spelling, or search by phone number.");
    expect(html).not.toMatch(/sorry|nothing found/i);
  });
});
