import Link from "next/link";
import { DuplicateResolver, type DuplicateReview } from "@/components/duplicate-resolver";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_duplicate_reviews");
  if (error) throw new Error(`Unable to load duplicates: ${error.message}`);

  const reviews = (data ?? []) as DuplicateReview[];

  return (
    <main className="pageShell">
      <div className="pageTitleRow">
        <div>
          <h1>Possible duplicates</h1>
          <p>Compare each pair, then merge them into one record or keep both.</p>
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
