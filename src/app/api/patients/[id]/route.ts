import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PatientUpdate, normalizePatientUpdate } from "@/lib/patients/schema";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid patient reference." }, { status: 400 });
  }

  const parsed = PatientUpdate.safeParse(await request.json());
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

  const input = normalizePatientUpdate(parsed.data);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

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

  if (error) {
    const text = `${error.message} ${error.details ?? ""}`.toLowerCase();
    if (error.code === "23505" && text.includes("patients_file_number_key")) {
      return NextResponse.json({ error: "That file number is already in use by another patient." }, { status: 409 });
    }
    if (error.code === "23505" && text.includes("patients_unique_identity_idx")) {
      return NextResponse.json({ error: "Another patient already has this identity number." }, { status: 409 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ error: "This patient no longer exists." }, { status: 404 });
    }
    if (error.code === "55000") {
      return NextResponse.json(
        { error: "This record was merged into another patient file and is read only." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "The patient could not be updated." }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ id: row?.patient_id ?? id, file_number: row?.file_number }, { status: 200 });
}

// There is intentionally no DELETE handler: patient records are never hard
// deleted (HPCSA retention). Duplicates are resolved by merging — see
// /api/patients/duplicates/merge.
