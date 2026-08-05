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

type MutationContext =
  | "create"
  | "update"
  | "merge"
  | "resolve"
  | "duplicates"
  | "archive"
  | "restore";

type Mapped = {
  status: number;
  body: { error: string; code?: string };
  /** False when nothing recognised the error, so the log line says so. */
  recognised: boolean;
};

/**
 * PostgREST cannot find something the app asked for. This is almost always
 * schema drift — the database is missing a migration this build depends on —
 * and it used to surface as a bare 500 with nothing in the logs.
 */
const SCHEMA_CACHE_CODES = new Set(["PGRST200", "PGRST202", "PGRST203", "PGRST204"]);

function mapToPayload(error: PgLikeError, context: MutationContext): Mapped {
  const code = error.code ?? "";
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (SCHEMA_CACHE_CODES.has(code)) {
    return {
      status: 500,
      body: {
        error:
          "The database is out of date with this version of the app. A migration has not been applied — tell whoever manages the deployment.",
        code: "schema_out_of_date",
      },
      recognised: true,
    };
  }

  if (code === "42501") {
    if (context === "restore" || text.includes("doctor")) {
      return {
        status: 403,
        body: { error: "Only a doctor can restore an archived patient file." },
        recognised: true,
      };
    }
    return { status: 403, body: { error: "Staff access required." }, recognised: true };
  }

  if (code === "23505" && text.includes("patients_file_number_key")) {
    return {
      status: 409,
      body: {
        error:
          context === "create"
            ? "That file number is already in use. Enter a different one or leave it blank to auto-generate."
            : "That file number is already in use by another patient.",
      },
      recognised: true,
    };
  }

  if (code === "23505" && text.includes("patients_unique_identity_idx")) {
    return {
      status: 409,
      body: {
        error:
          context === "create"
            ? "A patient with this identity already exists."
            : "Another patient already has this identity number.",
      },
      recognised: true,
    };
  }

  if (code === "23514") {
    if (
      text.includes("patients_contact_shape_check") ||
      text.includes("patients_phone_check") ||
      text.includes("patients_residential_address_check")
    ) {
      return {
        status: 422,
        body: {
          error:
            "Add a mobile number and residential address, or tick “no contact details on file” and record a reason.",
        },
        recognised: true,
      };
    }
    if (text.includes("patients_postal_code_check")) {
      return {
        status: 422,
        body: { error: "Enter a four-digit postal code, or leave it blank." },
        recognised: true,
      };
    }
    if (text.includes("patients_identity_shape_check")) {
      return {
        status: 422,
        body: {
          error:
            "Select why no identity document is on file, and add a note when the reason is “Other”.",
        },
        recognised: true,
      };
    }
    // Some other check constraint. Still the submission's fault, so 422 rather
    // than a 500 — and the log line below names the constraint.
    return {
      status: 422,
      body: { error: "Some of this information is not allowed by the database. Review the form." },
      recognised: true,
    };
  }

  if (code === "22023" && text.includes("soft_duplicate")) {
    return {
      status: 409,
      body: {
        error:
          "Possible existing patients were found since this form was opened. Review the updated list before saving.",
        code: "duplicate_review_required",
      },
      recognised: true,
    };
  }

  if (code === "P0002") {
    if (context === "create") {
      return {
        status: 404,
        body: { error: "That file no longer exists. Open the file and use “Add a person to this file”." },
        recognised: true,
      };
    }
    if (context === "merge") {
      return { status: 404, body: { error: "One of these records no longer exists." }, recognised: true };
    }
    if (context === "resolve") {
      return {
        status: 404,
        body: { error: "This pair is no longer flagged as a possible duplicate." },
        recognised: true,
      };
    }
    return { status: 404, body: { error: "This patient no longer exists." }, recognised: true };
  }

  // Adding someone to a file works by extending the consent already signed for
  // it. A file with no signature on record has nothing to extend.
  if (code === "22023" && text.includes("file_consent_missing")) {
    return {
      status: 409,
      body: {
        error:
          "This file has no signed consent on record, so nobody can be added to it. Register this person on their own file instead.",
        code: "file_consent_missing",
      },
      recognised: true,
    };
  }

  if (code === "22023" && context === "restore") {
    return { status: 409, body: { error: "Only archived records can be restored." }, recognised: true };
  }

  if (code === "55000") {
    if (context === "merge") {
      return {
        status: 409,
        body: { error: "This pair was already resolved by someone else. Refresh to see the current queue." },
        recognised: true,
      };
    }
    if (context === "archive") {
      return { status: 409, body: { error: "This record is already archived." }, recognised: true };
    }
    if (context === "restore" || text.includes("merged")) {
      return {
        status: 409,
        body: {
          error:
            "This record was merged into another patient file and cannot be restored. Open the kept file instead.",
        },
        recognised: true,
      };
    }
    return {
      status: 409,
      body: { error: "This record was merged into another patient file and is read only." },
      recognised: true,
    };
  }

  // A guard inside one of the patient RPCs rejected the payload (22023 is what
  // they raise for "this submission is not valid"). Treat it as the client's
  // fault rather than a server fault; the real message goes to the log.
  if (code === "22023") {
    return {
      status: 422,
      body: { error: "This submission was rejected as incomplete. Review the form and try again." },
      recognised: true,
    };
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

  return { status: 500, body: { error: fallback }, recognised: false };
}

/**
 * Map Postgres / Supabase RPC errors to stable HTTP responses.
 * Prefer errcode over message text; message includes are a last resort for unique violations.
 *
 * Every failure is logged with its Postgres code before the response is built.
 * Without this the user-facing text is all anyone gets, and a generic 500 says
 * nothing about which constraint or which missing migration caused it.
 */
export function mapPatientMutationError(
  error: PgLikeError,
  context: MutationContext = "update",
): NextResponse {
  const { status, body, recognised } = mapToPayload(error, context);

  const parts = [
    `Patient ${context} failed:`,
    `[${error.code || "no-code"}]`,
    error.message || "(no message)",
  ];
  if (error.details) parts.push(`| ${error.details}`);
  parts.push(`-> HTTP ${status}`);
  if (!recognised) parts.push("(unmapped)");
  console.error(parts.join(" "));

  return NextResponse.json(body, { status });
}
