import { describe, expect, it } from "vitest";
import { defaultExpandedFiles, groupByFile, type GroupablePatient } from "./file-groups";

function patient(over: Partial<GroupablePatient> & { id: string; file_number: string }): GroupablePatient {
  return {
    first_names: "A",
    surname: "B",
    date_of_birth: "1990-01-01",
    identity_type: "sa_id",
    phone: null,
    ...over,
  };
}

describe("groupByFile", () => {
  it("collapses three patients on one file into a single group", () => {
    const groups = groupByFile([
      patient({ id: "1", file_number: "2014" }),
      patient({ id: "2", file_number: "2014" }),
      patient({ id: "3", file_number: "2014" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].file_number).toBe("2014");
    expect(groups[0].patients).toHaveLength(3);
  });

  it("keeps separate files separate and preserves result order", () => {
    const groups = groupByFile([
      patient({ id: "1", file_number: "2014" }),
      patient({ id: "2", file_number: "1877" }),
      patient({ id: "3", file_number: "2014" }),
    ]);
    expect(groups.map((g) => g.file_number)).toEqual(["2014", "1877"]);
    expect(groups[0].patients).toHaveLength(2);
    expect(groups[1].patients).toHaveLength(1);
  });

  it("lifts the shared phone onto the file", () => {
    const groups = groupByFile([
      patient({ id: "1", file_number: "2014", phone: "0839274199" }),
      patient({ id: "2", file_number: "2014", phone: "0839274199" }),
    ]);
    expect(groups[0].phone).toBe("0839274199");
  });

  it("takes the phone from the first member that has one", () => {
    const groups = groupByFile([
      patient({ id: "1", file_number: "2014", phone: null }),
      patient({ id: "2", file_number: "2014", phone: "0839274199" }),
    ]);
    expect(groups[0].phone).toBe("0839274199");
  });

  it("returns no groups for no results", () => {
    expect(groupByFile([])).toEqual([]);
  });
});

describe("defaultExpandedFiles", () => {
  const multi = groupByFile([
    patient({ id: "1", file_number: "2014" }),
    patient({ id: "2", file_number: "2014" }),
    patient({ id: "3", file_number: "1877" }),
    patient({ id: "4", file_number: "1901" }),
  ]);

  it("expands the file the query named by number", () => {
    expect(defaultExpandedFiles(multi, "2014").has("2014")).toBe(true);
  });

  it("expands multi-patient files on a name search, collapsing single ones", () => {
    const expanded = defaultExpandedFiles(multi, "mokoena");
    expect(expanded.has("2014")).toBe(true);
    expect(expanded.has("1877")).toBe(false);
    expect(expanded.has("1901")).toBe(false);
  });

  it("expands when there is only one file in the result set", () => {
    const single = groupByFile([patient({ id: "1", file_number: "1877" })]);
    expect(defaultExpandedFiles(single, "").has("1877")).toBe(true);
  });

  it("collapses everything when browsing with no query", () => {
    expect(defaultExpandedFiles(multi, "").size).toBe(0);
  });
});
