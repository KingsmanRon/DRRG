import { NextResponse, type NextRequest } from "next/server";
import { CONSENT_TEXT_HASH, CONSENT_VERSION } from "@/lib/consent";
import { isDemoMode } from "@/lib/env";
import { PatientInput, normalizePatientInput } from "@/lib/patients/schema";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const parsed = PatientInput.safeParse(await request.json());
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: firstIssue?.message ?? "Review the patient information.",
        fields: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  const input = normalizePatientInput(parsed.data);
  if (input.consent_version !== CONSENT_VERSION || input.consent_text_hash !== CONSENT_TEXT_HASH) {
    return NextResponse.json({ error: "The consent text has changed. Reload the form and capture consent again." }, { status: 422 });
  }

  if (isDemoMode()) {
    return NextResponse.json(
      { id: "f3bff3ca-8279-45a6-9350-dba990872d75", file_number: "DRRG00001257" },
      { status: 201 },
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data, error } = await supabase.rpc("onboard_patient", {
    p_patient: {
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

  if (error) {
    const text = `${error.message} ${error.details ?? ""}`.toLowerCase();
    if (error.code === "23505" && text.includes("patients_unique_identity_idx")) {
      return NextResponse.json({ error: "A patient with this identity already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "The patient could not be saved." }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.patient_id || !row?.file_number) {
    return NextResponse.json({ error: "The patient was not created." }, { status: 500 });
  }

  return NextResponse.json({ id: row.patient_id, file_number: row.file_number }, { status: 201 });
}
