import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { mapPatientMutationError, validationErrorResponse } from "@/lib/api/errors";
import { requireStaffApi } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const MergeRequest = z
  .object({
    survivor_id: z.uuid(),
    source_id: z.uuid(),
  })
  .refine((value) => value.survivor_id !== value.source_id, {
    message: "A record cannot be merged into itself.",
  });

export async function POST(request: NextRequest) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;

  const parsed = MergeRequest.safeParse(await request.json());
  if (!parsed.success) {
    return validationErrorResponse(parsed.error, "Select the record to keep.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_patients", {
    p_survivor_id: parsed.data.survivor_id,
    p_source_id: parsed.data.source_id,
  });

  if (error) return mapPatientMutationError(error, "merge");

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(
    {
      id: row?.patient_id ?? parsed.data.survivor_id,
      file_number: row?.file_number,
      fields_copied: row?.fields_copied ?? [],
    },
    { status: 200 },
  );
}
