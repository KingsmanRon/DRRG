import Link from "next/link";
import { DuplicateResolver, type DuplicateReview } from "@/components/duplicate-resolver";
import type { DuplicateTier } from "@/lib/patients/duplicate-score";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

function asSide(value: Json): DuplicateReview["patient"] {
  const row = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return {
    id: String(row.id ?? ""),
    file_number: String(row.file_number ?? ""),
    first_names: String(row.first_names ?? ""),
    surname: String(row.surname ?? ""),
    date_of_birth: String(row.date_of_birth ?? ""),
    identity_type: String(row.identity_type ?? "none"),
    identity_last4: row.identity_last4 == null ? null : String(row.identity_last4),
    phone: String(row.phone ?? ""),
    email: row.email == null ? null : String(row.email),
    residential_address: String(row.residential_address ?? ""),
    status: String(row.status ?? "active"),
  };
}

function mapReviews(data: unknown): DuplicateReview[] {
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const item = row as {
      review_id: string;
      reviewed_at: string;
      review_reason: string;
      match_score: number;
      match_tier: string;
      match_reasons: string[] | null;
      identity_match: boolean;
      patient: Json;
      candidate: Json;
    };
    const tier = (
      item.match_tier === "likely" || item.match_tier === "possible" ? item.match_tier : "possible"
    ) as DuplicateTier;
    return {
      review_id: item.review_id,
      reviewed_at: item.reviewed_at,
      review_reason: item.review_reason,
      match_score: item.match_score,
      match_tier: tier,
      match_reasons: item.match_reasons ?? [],
      identity_match: item.identity_match,
      patient: asSide(item.patient),
      candidate: asSide(item.candidate),
    };
  });
}

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_duplicate_reviews");
  if (error) throw new Error(`Unable to load duplicates: ${error.message}`);

  const reviews = mapReviews(data);

  return (
    <main className="pageShell">
      <div className="pageTitleRow">
        <div>
          <h1>Possible duplicates</h1>
          <p className="pageSubtitle">
            Compare each pair. Merge if it is the same person, or keep both files if they are different people.
          </p>
          <div className="dupLegend" aria-hidden="true">
            <span className="dupLegendItem"><span className="dupSwatch dupSwatchMatch" />Matching</span>
            <span className="dupLegendItem"><span className="dupSwatch dupSwatchDiff" />Different or missing</span>
          </div>
        </div>
        <Link className="button buttonSecondary" href="/patients">Back to patients</Link>
      </div>

      <DuplicateResolver reviews={reviews} focusPatientId={params.patient} />
    </main>
  );
}
