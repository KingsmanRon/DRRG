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
          <p>Compare each pair, then delete a file or keep both as different patients.</p>
        </div>
        <Link className="button buttonSecondary" href="/patients">Back to patients</Link>
      </div>

      <DuplicateResolver reviews={reviews} />
    </main>
  );
}
