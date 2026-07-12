import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { mapPatientMutationError, validationErrorResponse } from "@/lib/api/errors";
import { requireStaffApi } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();
const ArchiveBody = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Record why this file is being archived (at least 5 characters).")
    .max(500, "Keep the reason under 500 characters."),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid patient reference." }, { status: 400 });
  }

  const parsed = ArchiveBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationErrorResponse(parsed.error, "Provide a reason for archiving.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("archive_patient", {
    p_id: id,
    p_reason: parsed.data.reason,
  });

  if (error) return mapPatientMutationError(error, "archive");

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(
    { id: row?.patient_id ?? id, file_number: row?.file_number },
    { status: 200 },
  );
}
