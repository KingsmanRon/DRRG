import Link from "next/link";
import { DuplicateResolver, type DuplicateReview } from "@/components/duplicate-resolver";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_duplicate_reviews");
  if (error) throw new Error(`Unable to load duplicates: ${error.message}`);

  const reviews = (data ?? []) as DuplicateReview[];

  return (
    <main className="pageShell">
      <div className="pageTitleRow">
        <div>
          <h1>Possible duplicates</h1>
          <p>Compare each pair and decide whether to keep or remove a record.</p>
          <div className="dupLegend" aria-hidden="true">
            <span className="dupLegendItem"><span className="dupSwatch dupSwatchMatch" />Matching</span>
            <span className="dupLegendItem"><span className="dupSwatch dupSwatchDiff" />Different or missing</span>
          </div>
        </div>
        <Link className="button buttonSecondary" href="/patients">Back to patients</Link>
      </div>

      <DuplicateResolver reviews={reviews} />
    </main>
  );
}
