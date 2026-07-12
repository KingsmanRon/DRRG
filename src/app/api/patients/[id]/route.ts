import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { mapPatientMutationError, validationErrorResponse } from "@/lib/api/errors";
import { requireStaffApi } from "@/lib/auth/session";
import { PatientUpdate, normalizePatientUpdate } from "@/lib/patients/schema";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid patient reference." }, { status: 400 });
  }

  const parsed = PatientUpdate.safeParse(await request.json());
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const input = normalizePatientUpdate(parsed.data);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_patient", {
    p_id: id,
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
    },
  });

  if (error) return mapPatientMutationError(error, "update");

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ id: row?.patient_id ?? id, file_number: row?.file_number }, { status: 200 });
}

// There is intentionally no DELETE handler: patient records are never hard
// deleted (HPCSA retention). Duplicates are resolved by merging — see
// /api/patients/duplicates/merge.
