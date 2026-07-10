import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const ResolveRequest = z.object({
  patient_id: z.uuid(),
  candidate_id: z.uuid(),
  reason: z.string().trim().min(5, "Record why these are different patients.").max(500),
});

export async function POST(request: NextRequest) {
  const parsed = ResolveRequest.safeParse(await request.json());
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json({ error: firstIssue?.message ?? "Provide a resolution reason." }, { status: 422 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { error } = await supabase.rpc("resolve_duplicate", {
    p_patient_id: parsed.data.patient_id,
    p_candidate_id: parsed.data.candidate_id,
    p_reason: parsed.data.reason,
  });

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json({ error: "This pair is no longer flagged as a possible duplicate." }, { status: 404 });
    }
    return NextResponse.json({ error: "The duplicate could not be resolved." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
