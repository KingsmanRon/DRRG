/**
 * The registration-time duplicate check, shared by both ways of registering
 * someone: the four-step form for a new file and the single screen for adding a
 * person to one that exists. Keeping one caller means a change to what counts
 * as a match cannot reach one form and miss the other.
 */

export type Candidate = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  date_of_birth: string;
  phone: string | null;
  identity_last4: string | null;
  residential_address: string | null;
  postal_code: string | null;
  match_score: number;
  match_tier?: string;
  match_reasons: string[];
};

export type DuplicateCheckRequest = {
  first_names: string;
  surname: string;
  date_of_birth: string;
  identity_type: string;
  identity_number: string;
  identity_country: string;
  phone: string;
  email: string;
  residential_address: string;
  /** The household this person is joining; its members are not candidates. */
  file_number: string;
  join_file: boolean;
};

export type DuplicateCheckOutcome =
  /** The search ran. An empty list means nothing looked like this person. */
  | { status: "ok"; candidates: Candidate[] }
  /** This identity document already belongs to someone. Registration stops. */
  | { status: "identity_exists"; message: string }
  | { status: "error"; message: string };

const UNAVAILABLE = "Duplicate checking is temporarily unavailable.";

export async function checkForDuplicates(
  request: DuplicateCheckRequest,
): Promise<DuplicateCheckOutcome> {
  try {
    const response = await fetch("/api/patients/duplicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await response.json();

    if (response.status === 409) {
      return {
        status: "identity_exists",
        message: `This identity already belongs to patient file ${body.existing?.file_number ?? "on record"}. Open the existing patient instead.`,
      };
    }
    if (!response.ok) return { status: "error", message: body.error ?? UNAVAILABLE };
    return { status: "ok", candidates: body.candidates ?? [] };
  } catch {
    return { status: "error", message: UNAVAILABLE };
  }
}

/** The fields that move the match score — changing one invalidates a review. */
export const MATCHED_FIELDS = [
  "first_names",
  "surname",
  "date_of_birth",
  "identity_type",
  "identity_number",
  "identity_country",
  "phone",
  "email",
  "residential_address",
] as const;
