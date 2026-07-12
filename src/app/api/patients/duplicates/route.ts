import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { mapPatientMutationError, validationErrorResponse } from "@/lib/api/errors";
import { requireStaffApi } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const DuplicateRequest = z.object({
  first_names: z.string().trim().min(1).max(120),
  surname: z.string().trim().min(1).max(120),
  date_of_birth: z.iso.date(),
  identity_type: z.enum(["sa_id", "passport", "foreign_document", "none"]),
  identity_number: z.string().trim().max(80).default(""),
  identity_country: z.string().trim().max(2).default(""),
  phone: z.string().trim().max(30).default(""),
  email: z.string().trim().max(254).default(""),
  residential_address: z.string().trim().max(500).default(""),
});

function normalizeIdentityNumber(type: string, number: string): string {
  return type === "sa_id" ? number.replace(/\s/g, "") : number.trim().toUpperCase();
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;

  const parsed = DuplicateRequest.safeParse(await request.json());
  if (!parsed.success) {
    return validationErrorResponse(parsed.error, "Complete the patient identity details before checking.");
  }

  const input = parsed.data;
  const identityNumber = normalizeIdentityNumber(input.identity_type, input.identity_number);
  const identityCountry = input.identity_country.trim().toUpperCase();

  const supabase = await createClient();

  if (input.identity_type !== "none" && identityNumber) {
    let exactQuery = supabase
      .from("patients")
      .select("id, file_number")
      .eq("identity_type", input.identity_type)
      .eq("identity_number", identityNumber)
      .eq("status", "active")
      .limit(1);
    if (input.identity_type !== "sa_id") exactQuery = exactQuery.eq("identity_country", identityCountry);

    const { data: exactMatches, error: exactError } = await exactQuery;
    if (exactError) return mapPatientMutationError(exactError, "duplicates");
    if (exactMatches?.[0]) return NextResponse.json({ existing: exactMatches[0] }, { status: 409 });
  }

  const { data: candidates, error } = await supabase.rpc("find_possible_duplicates", {
    p_first_names: input.first_names,
    p_surname: input.surname,
    p_date_of_birth: input.date_of_birth,
    p_phone: input.phone,
    p_limit: 10,
    p_email: input.email,
    p_address: input.residential_address,
  });

  if (error) return mapPatientMutationError(error, "duplicates");
  return NextResponse.json({ candidates: candidates ?? [] });
}
