import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapPatientMutationError } from "./errors";

function body(response: Response): Promise<{ error?: string; code?: string }> {
  return response.json();
}

// Every mapped failure logs; silence it so test output stays readable, and keep
// the spy so the logging assertions below can read what was written.
let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
});

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

  it("maps the identity shape check to an actionable 422, not a 500", async () => {
    const response = mapPatientMutationError(
      {
        code: "23514",
        message: 'new row violates check constraint "patients_identity_shape_check"',
      },
      "create",
    );
    expect(response.status).toBe(422);
    const json = await body(response);
    expect(json.error).toMatch(/no identity document/i);
    expect(json.error).toMatch(/other/i);
  });

  it("maps an unrecognised check constraint to 422 rather than 500", async () => {
    const response = mapPatientMutationError(
      { code: "23514", message: 'violates check constraint "patients_some_new_check"' },
      "update",
    );
    expect(response.status).toBe(422);
  });

  it("maps a bare RPC guard rejection to 422 instead of a generic 500", async () => {
    // What the migrated onboard_patient raises when the reason code is absent.
    const response = mapPatientMutationError(
      { code: "22023", message: "an identity reason is required when no document is recorded" },
      "create",
    );
    expect(response.status).toBe(422);
    const json = await body(response);
    expect(json.error).toMatch(/review the form/i);
  });

  it("reports a missing function as schema drift, not a server fault", async () => {
    const response = mapPatientMutationError(
      {
        code: "PGRST202",
        message: "Could not find the function public.onboard_patient(...) in the schema cache",
      },
      "create",
    );
    const json = await body(response);
    expect(json.code).toBe("schema_out_of_date");
    expect(json.error).toMatch(/out of date|migration/i);
  });

  it("reports a missing column as schema drift too", async () => {
    const response = mapPatientMutationError(
      {
        code: "PGRST204",
        message: "Could not find the 'no_identity_reason_code' column of 'patients' in the schema cache",
      },
      "update",
    );
    const json = await body(response);
    expect(json.code).toBe("schema_out_of_date");
  });

  it("logs the Postgres code and message for every failure", () => {
    mapPatientMutationError(
      { code: "23514", message: 'violates check constraint "patients_identity_shape_check"' },
      "create",
    );
    expect(errorLog).toHaveBeenCalledTimes(1);
    const line = String(errorLog.mock.calls[0][0]);
    expect(line).toContain("23514");
    expect(line).toContain("patients_identity_shape_check");
    expect(line).toContain("HTTP 422");
  });

  it("marks an unmapped error in the log so drift is greppable", () => {
    const response = mapPatientMutationError({ code: "XX000", message: "internal error" }, "create");
    expect(response.status).toBe(500);
    const line = String(errorLog.mock.calls[0][0]);
    expect(line).toContain("(unmapped)");
  });
});
