import { listReviewQueue } from "@/app/(nebula)/nebula/actions";
import { ReviewQueueClient } from "./client";

interface SearchParams {
  status?: string;
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const status = (sp.status as "pending" | "merged" | "dismissed") ?? "pending";
  const initial = await listReviewQueue({ status, limit: 50 });

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-base font-semibold text-foreground mb-4">Review Queue</h2>
      <ReviewQueueClient initial={initial} initialStatus={status} />
    </div>
  );
}
