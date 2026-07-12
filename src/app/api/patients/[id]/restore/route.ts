import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { mapPatientMutationError } from "@/lib/api/errors";
import { requireStaffApi } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;

  if (auth.staff.role !== "doctor") {
    return NextResponse.json(
      { error: "Only a doctor can restore an archived patient file." },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid patient reference." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restore_patient", { p_id: id });

  if (error) return mapPatientMutationError(error, "restore");

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(
    { id: row?.patient_id ?? id, file_number: row?.file_number },
    { status: 200 },
  );
}
