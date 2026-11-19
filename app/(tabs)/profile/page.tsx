import { currentUser } from "@clerk/nextjs/server";
import { createAuthClient } from "@/lib/supabase-server";
import { SignOut } from "@/components/SignOut";

export default async function ProfilePage() {
  const user = await currentUser();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  let stats = { read: 0, reading: 0, wishlist: 0, owned: 0, clusters: 0, bridges: 0 };

  if (supabaseUrl) {
    const supabase = await createAuthClient();

    const [{ data: edges }, { data: belongsTo }] = await Promise.all([
      supabase
        .from("edges")
        .select("edge_type, target_id")
        .eq("source_type", "user")
        .eq("target_type", "book")
        .in("edge_type", ["owns", "read", "reading", "wishlist"]),
      supabase
        .from("edges")
        .select("source_id, target_id")
        .eq("source_type", "book")
        .eq("target_type", "subject")
        .eq("edge_type", "belongs_to"),
    ]);

    if (edges) {
      for (const e of edges) {
        if (e.edge_type === "read") stats.read++;
        else if (e.edge_type === "reading") stats.reading++;
        else if (e.edge_type === "wishlist") stats.wishlist++;
        else if (e.edge_type === "owns") stats.owned++;
      }
    }

    if (belongsTo) {
      const clusterIds = new Set(belongsTo.map((e) => e.target_id));
      stats.clusters = clusterIds.size;

      const bookClusters = new Map<string, Set<string>>();
      for (const e of belongsTo) {
        const set = bookClusters.get(e.source_id) ?? new Set();
        set.add(e.target_id);
        bookClusters.set(e.source_id, set);
      }
      for (const [, cls] of bookClusters) {
        if (cls.size > 1) stats.bridges++;
      }
    }
  }

  return (
    <div className="p-4 pt-16 space-y-3 max-w-xs pointer-events-none">
      <div data-overlay className="pointer-events-auto backdrop-blur-md bg-surface-solid/70 rounded-xl border border-border/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Profile</h2>
            <p className="text-xs text-muted mt-0.5">
              {user?.firstName ?? user?.emailAddresses[0]?.emailAddress}
            </p>
          </div>
          <SignOut />
        </div>
      </div>

      <div data-overlay className="pointer-events-auto grid grid-cols-3 gap-2">
        {[
          { label: "Read", value: stats.read },
          { label: "Reading", value: stats.reading },
          { label: "Wishlist", value: stats.wishlist },
        ].map((s) => (
          <div
            key={s.label}
            className="backdrop-blur-md bg-surface-solid/50 rounded-lg border border-border/30 p-2 text-center"
          >
            <p className="text-lg font-semibold text-foreground">{s.value}</p>
            <p className="text-[10px] text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <div data-overlay className="pointer-events-auto backdrop-blur-md bg-surface-solid/50 rounded-xl border border-border/30 p-3 space-y-1">
        <p className="text-[10px] text-muted">Constellation shape</p>
        <p className="text-xs text-foreground">
          {stats.clusters} clusters · {stats.owned + stats.read + stats.reading + stats.wishlist} stars · {stats.bridges} bridges
        </p>
      </div>
    </div>
  );
}
