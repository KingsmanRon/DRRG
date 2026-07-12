import { describe, expect, it } from "vitest";
import { mapPatientMutationError } from "./errors";

function body(response: Response): Promise<{ error?: string; code?: string }> {
  return response.json();
}

describe("mapPatientMutationError", () => {
  it("maps unique file number conflicts to 409", async () => {
    const response = mapPatientMutationError(
      { code: "23505", message: 'duplicate key value violates unique constraint "patients_file_number_key"' },
      "create",
    );
    expect(response.status).toBe(409);
    const json = await body(response);
    expect(json.error).toMatch(/file number/i);
  });

  it("maps soft-duplicate review to a stable client code", async () => {
    const response = mapPatientMutationError(
      { code: "22023", message: "soft_duplicate_review_required", details: "soft_duplicate" },
      "create",
    );
    expect(response.status).toBe(409);
    const json = await body(response);
    expect(json.code).toBe("duplicate_review_required");
  });

  it("maps concurrent merge resolution to 409", async () => {
    const response = mapPatientMutationError(
      { code: "55000", message: "merge_already_resolved" },
      "merge",
    );
    expect(response.status).toBe(409);
    const json = await body(response);
    expect(json.error).toMatch(/already resolved/i);
  });

  it("maps missing staff to 403", async () => {
    const response = mapPatientMutationError({ code: "42501", message: "permission denied" }, "update");
    expect(response.status).toBe(403);
  });

  it("maps already-archived to 409 on archive", async () => {
    const response = mapPatientMutationError(
      { code: "55000", message: "patient_already_archived" },
      "archive",
    );
    expect(response.status).toBe(409);
    const json = await body(response);
    expect(json.error).toMatch(/already archived/i);
  });

  it("maps merged-readonly restore to 409", async () => {
    const response = mapPatientMutationError(
      { code: "55000", message: "patient_merged_readonly: cannot restore" },
      "restore",
    );
    expect(response.status).toBe(409);
    const json = await body(response);
    expect(json.error).toMatch(/merged/i);
  });
});
