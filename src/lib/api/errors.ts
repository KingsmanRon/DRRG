import { NextResponse } from "next/server";
import type { z } from "zod";
import { fieldErrorsFromZod } from "../patients/schema";

export function validationErrorResponse(error: z.ZodError, fallback = "Review the patient information.") {
  const firstIssue = error.issues[0];
  return NextResponse.json(
    {
      error: firstIssue?.message ?? fallback,
      fields: fieldErrorsFromZod(error),
    },
    { status: 422 },
  );
}

type PgLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
};

/**
 * Map Postgres / Supabase RPC errors to stable HTTP responses.
 * Prefer errcode over message text; message includes are a last resort for unique violations.
 */
export function mapPatientMutationError(
  error: PgLikeError,
  context: "create" | "update" | "merge" | "resolve" | "duplicates" | "archive" | "restore" = "update",
): NextResponse {
  const code = error.code ?? "";
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (code === "42501") {
    if (context === "restore" || text.includes("doctor")) {
      return NextResponse.json(
        { error: "Only a doctor can restore an archived patient file." },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "Staff access required." }, { status: 403 });
  }

  if (code === "23505" && text.includes("patients_file_number_key")) {
    return NextResponse.json(
      {
        error:
          context === "create"
            ? "That file number is already in use. Enter a different one or leave it blank to auto-generate."
            : "That file number is already in use by another patient.",
      },
      { status: 409 },
    );
  }

  if (code === "23505" && text.includes("patients_unique_identity_idx")) {
    return NextResponse.json(
      {
        error:
          context === "create"
            ? "A patient with this identity already exists."
            : "Another patient already has this identity number.",
      },
      { status: 409 },
    );
  }

  if (
    code === "23514" &&
    (text.includes("patients_contact_shape_check") ||
      text.includes("patients_phone_check") ||
      text.includes("patients_residential_address_check"))
  ) {
    return NextResponse.json(
      {
        error:
          "Add a mobile number and residential address, or tick “no contact details on file” and record a reason.",
      },
      { status: 422 },
    );
  }

  if (code === "22023" && text.includes("soft_duplicate")) {
    return NextResponse.json(
      {
        error: "Possible existing patients were found since this form was opened. Review the updated list before saving.",
        code: "duplicate_review_required",
      },
      { status: 409 },
    );
  }

  if (code === "P0002") {
    if (context === "merge") {
      return NextResponse.json({ error: "One of these records no longer exists." }, { status: 404 });
    }
    if (context === "resolve") {
      return NextResponse.json(
        { error: "This pair is no longer flagged as a possible duplicate." },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: "This patient no longer exists." }, { status: 404 });
  }

  if (code === "22023" && context === "restore") {
    return NextResponse.json(
      { error: "Only archived records can be restored." },
      { status: 409 },
    );
  }

  if (code === "55000") {
    if (context === "merge") {
      return NextResponse.json(
        { error: "This pair was already resolved by someone else. Refresh to see the current queue." },
        { status: 409 },
      );
    }
    if (context === "archive") {
      return NextResponse.json(
        { error: "This record is already archived." },
        { status: 409 },
      );
    }
    if (context === "restore" || text.includes("merged")) {
      return NextResponse.json(
        {
          error:
            "This record was merged into another patient file and cannot be restored. Open the kept file instead.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "This record was merged into another patient file and is read only." },
      { status: 409 },
    );
  }

  const fallback =
    context === "create"
      ? "The patient could not be saved."
      : context === "merge"
        ? "The records could not be merged."
        : context === "resolve"
          ? "The duplicate could not be resolved."
          : context === "duplicates"
            ? "Unable to check possible duplicates."
            : context === "archive"
              ? "The patient could not be archived."
              : context === "restore"
                ? "The patient could not be restored."
                : "The patient could not be updated.";

  return NextResponse.json({ error: fallback }, { status: 500 });
}
