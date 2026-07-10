import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
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
  const parsed = MergeRequest.safeParse(await request.json());
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json({ error: firstIssue?.message ?? "Select the record to keep." }, { status: 422 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data, error } = await supabase.rpc("merge_patients", {
    p_survivor_id: parsed.data.survivor_id,
    p_source_id: parsed.data.source_id,
  });

  if (error) {
    if (error.code === "55000") {
      return NextResponse.json(
        { error: "This pair was already resolved by someone else. Refresh to see the current queue." },
        { status: 409 },
      );
    }
    if (error.code === "P0002") {
      return NextResponse.json({ error: "One of these records no longer exists." }, { status: 404 });
    }
    return NextResponse.json({ error: "The records could not be merged." }, { status: 500 });
  }

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
