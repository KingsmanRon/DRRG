import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PatientTable, type PatientListItem } from "./patient-table";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function patient(over: Partial<PatientListItem> & { id: string; file_number: string }): PatientListItem {
  return {
    first_names: "A", surname: "B", date_of_birth: "1990-01-01",
    identity_type: "none", identity_last4: null, phone: null,
    status: "active", file_member_count: 1, ...over,
  };
}

// The rows from the screenshot: file 2014 twice, then single-patient files.
const rows = [
  patient({ id: "1", file_number: "2014", first_names: "Neo", surname: "Phale", date_of_birth: "1994-12-29", phone: "0839274199", file_member_count: 3 }),
  patient({ id: "2", file_number: "2014", first_names: "Lindiwe", surname: "Mabaso", date_of_birth: "1985-11-15", phone: "0839274199", file_member_count: 3 }),
  patient({ id: "3", file_number: "2082", first_names: "Maleshoane", surname: "Namane", date_of_birth: "1993-01-15", phone: "0780552897" }),
  patient({ id: "4", file_number: "2081", first_names: "Ben", surname: "Mochana", date_of_birth: "1921-09-07", phone: "0732299639", identity_type: "sa_id", identity_last4: "2083" }),
];

function render(patients: PatientListItem[], query = "") {
  return renderToStaticMarkup(
    <PatientTable patients={patients} total={patients.length} page={1} pageSize={15}
      heading="Recently registered" query={query} emptyMessage="none" />,
  );
}

function occurrences(h: string, n: string) { return h.split(n).length - 1; }

describe("file grouping in the register", () => {
  it("shows a shared file number once instead of on every row", () => {
    expect(occurrences(render(rows), ">2014<")).toBe(1);
  });

  it("shows the shared phone once on the file header", () => {
    // Collapsed by default when browsing, so the members' phones are not rendered.
    expect(occurrences(render(rows), "0839274199")).toBe(1);
  });

  it("still lists the names on the collapsed header so they stay findable", () => {
    const html = render(rows);
    expect(html).toContain("Neo Phale · Lindiwe Mabaso");
  });

  it("gives the file header a real button reporting expanded state", () => {
    expect(render(rows)).toMatch(/<button[^>]+aria-expanded="false"[^>]+aria-controls="/);
  });

  it("opens matched files when a search is running", () => {
    expect(render(rows, "2014")).toMatch(/aria-expanded="true"/);
  });

  it("leaves single-patient files exactly as they were — no header, no chevron", () => {
    const html = render([rows[2]]);
    expect(html).not.toContain("fileGroupToggle");
    expect(html).toContain(">2082<");
    expect(html).toContain("Maleshoane Namane");
  });

  it("says how many of the file's people are on this page when it is split", () => {
    // file_member_count is 3 but only 2 rows landed on this page.
    expect(render(rows)).toContain("3 people · 2 on this page");
  });

  it("drops the split note once the whole file is on the page", () => {
    const whole = [...rows.slice(0, 2), patient({ id: "5", file_number: "2014", first_names: "Lesedi", surname: "Phale", phone: "0839274199", file_member_count: 3 })];
    const html = render(whole);
    expect(html).toContain("3 people");
    expect(html).not.toContain("on this page");
  });

  it("keeps every patient reachable when expanded", () => {
    const html = render(rows, "2014");
    expect(html).toContain('href="/patients/1"');
    expect(html).toContain('href="/patients/2"');
  });

  it("keeps the Cash patient chip and Open buttons untouched", () => {
    const html = render(rows, "2014");
    expect(occurrences(html, "Cash patient")).toBe(4);
    expect(occurrences(html, ">Open<")).toBe(4);
  });
});
