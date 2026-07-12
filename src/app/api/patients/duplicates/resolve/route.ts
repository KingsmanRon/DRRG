import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { mapPatientMutationError, validationErrorResponse } from "@/lib/api/errors";
import { requireStaffApi } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const ResolveRequest = z.object({
  patient_id: z.uuid(),
  candidate_id: z.uuid(),
  reason: z.string().trim().min(5, "Record why these are different patients.").max(500),
});

export async function POST(request: NextRequest) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;

  const parsed = ResolveRequest.safeParse(await request.json());
  if (!parsed.success) {
    return validationErrorResponse(parsed.error, "Provide a resolution reason.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_duplicate", {
    p_patient_id: parsed.data.patient_id,
    p_candidate_id: parsed.data.candidate_id,
    p_reason: parsed.data.reason,
  });

  if (error) return mapPatientMutationError(error, "resolve");

  return NextResponse.json({ ok: true }, { status: 200 });
}
