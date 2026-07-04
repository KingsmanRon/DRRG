import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { demoPatients } from "@/lib/patients/demo";
import { normalisePhone } from "@/lib/patients/phone";
import { createClient } from "@/lib/supabase/server";

const DuplicateRequest = z.object({
  first_names: z.string().trim().min(1).max(120),
  surname: z.string().trim().min(1).max(120),
  date_of_birth: z.iso.date(),
  identity_type: z.enum(["sa_id", "passport", "foreign_document", "none"]),
  identity_number: z.string().trim().max(80).default(""),
  identity_country: z.string().trim().max(2).default(""),
  phone: z.string().trim().max(30).default(""),
});

function normalizeIdentityNumber(type: string, number: string): string {
  return type === "sa_id" ? number.replace(/\s/g, "") : number.trim().toUpperCase();
}

export async function POST(request: NextRequest) {
  const parsed = DuplicateRequest.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Complete the patient identity details before checking." }, { status: 422 });
  }

  const input = parsed.data;
  const identityNumber = normalizeIdentityNumber(input.identity_type, input.identity_number);
  const identityCountry = input.identity_country.trim().toUpperCase();

  if (isDemoMode()) {
    const exact = input.identity_type === "none"
      ? undefined
      : demoPatients.find((patient) => patient.identity_number === identityNumber);
    if (exact) {
      return NextResponse.json({ existing: { id: exact.id, file_number: exact.file_number } }, { status: 409 });
    }

    const surname = input.surname.trim().toLowerCase();
    const candidates = demoPatients
      .filter((patient) => patient.surname.toLowerCase() === surname || normalisePhone(patient.phone) === normalisePhone(input.phone))
      .slice(0, 5)
      .map((patient) => ({
        ...patient,
        match_score: patient.surname.toLowerCase() === surname && patient.date_of_birth === input.date_of_birth ? 85 : 55,
        match_reasons: ["same_surname", "same_date_of_birth"],
      }));
    return NextResponse.json({ candidates });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  if (input.identity_type !== "none" && identityNumber) {
    let exactQuery = supabase
      .from("patients")
      .select("id, file_number")
      .eq("identity_type", input.identity_type)
      .eq("identity_number", identityNumber)
      .limit(1);
    if (input.identity_type !== "sa_id") exactQuery = exactQuery.eq("identity_country", identityCountry);

    const { data: exactMatches, error: exactError } = await exactQuery;
    if (exactError) return NextResponse.json({ error: "Unable to check identity duplicates." }, { status: 500 });
    if (exactMatches?.[0]) return NextResponse.json({ existing: exactMatches[0] }, { status: 409 });
  }

  const { data: candidates, error } = await supabase.rpc("find_possible_duplicates", {
    p_first_names: input.first_names,
    p_surname: input.surname,
    p_date_of_birth: input.date_of_birth,
    p_phone: input.phone,
    p_limit: 5,
  });

  if (error) return NextResponse.json({ error: "Unable to check possible duplicates." }, { status: 500 });
  return NextResponse.json({ candidates: candidates ?? [] });
}
