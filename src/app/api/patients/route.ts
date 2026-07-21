import { NextResponse, type NextRequest } from "next/server";
import { mapPatientMutationError, validationErrorResponse } from "@/lib/api/errors";
import { requireStaffApi } from "@/lib/auth/session";
import { CONSENT_TEXT_HASH, CONSENT_VERSION } from "@/lib/consent";
import { PatientInput, normalizePatientInput } from "@/lib/patients/schema";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;

  const parsed = PatientInput.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const input = normalizePatientInput(parsed.data);
  if (input.consent_version !== CONSENT_VERSION || input.consent_text_hash !== CONSENT_TEXT_HASH) {
    return NextResponse.json(
      { error: "The consent text has changed. Reload the form and capture consent again." },
      { status: 422 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("onboard_patient", {
    p_patient: {
      file_number: input.file_number,
      first_names: input.first_names,
      surname: input.surname,
      date_of_birth: input.date_of_birth,
      identity_type: input.identity_type,
      identity_number: input.identity_number,
      identity_country: input.identity_country,
      no_identity_reason: input.no_identity_reason,
      phone: input.phone,
      email: input.email,
      residential_address: input.residential_address,
      no_contact_reason: input.no_contact_reason,
    },
    p_consent: {
      consent_version: input.consent_version,
      consent_text_hash: input.consent_text_hash,
      signature_type: input.signature_type,
      signature_value: input.signature_value,
      patient_present_attestation: input.patient_present_attestation,
    },
    p_duplicate_candidate_ids: input.duplicate_candidate_ids,
    p_duplicate_review_reason: input.duplicate_review_reason,
  });

  if (error) return mapPatientMutationError(error, "create");

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.patient_id || !row?.file_number) {
    return NextResponse.json({ error: "The patient was not created." }, { status: 500 });
  }

  return NextResponse.json({ id: row.patient_id, file_number: row.file_number }, { status: 201 });
}
