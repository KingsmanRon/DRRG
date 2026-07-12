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
  context: "create" | "update" | "merge" | "resolve" | "duplicates" = "update",
): NextResponse {
  const code = error.code ?? "";
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (code === "42501") {
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

  if (code === "55000") {
    if (context === "merge") {
      return NextResponse.json(
        { error: "This pair was already resolved by someone else. Refresh to see the current queue." },
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
            : "The patient could not be updated.";

  return NextResponse.json({ error: fallback }, { status: 500 });
}
