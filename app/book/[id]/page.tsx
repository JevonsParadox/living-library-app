import { createAuthClient } from "@/lib/supabase-server";
import { BookOpen } from "lucide-react";
import Link from "next/link";

const statusLabels: Record<string, string> = {
  owns: "Owned",
  reading: "Reading",
  read: "Read",
  wishlist: "Wishlist",
};

const statusColors: Record<string, string> = {
  owns: "bg-foreground/10 text-foreground",
  reading: "bg-amber-500/15 text-amber-300",
  read: "bg-emerald-500/15 text-emerald-300",
  wishlist: "bg-blue-500/15 text-blue-300",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function BookDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createAuthClient();

  const { data: book } = await supabase
    .from("books")
    .select("*")
    .eq("id", id)
    .single();

  if (!book) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted">Book not found</p>
      </div>
    );
  }

  // Fetch user→book edge + author in parallel
  const [{ data: userEdge }, { data: wroteEdge }] = await Promise.all([
    supabase
      .from("edges")
      .select("edge_type, metadata")
      .eq("source_type", "user")
      .eq("target_type", "book")
      .eq("target_id", id)
      .in("edge_type", ["owns", "reading", "read", "wishlist"])
      .single(),
    supabase
      .from("edges")
      .select("source_id")
      .eq("source_type", "author")
      .eq("target_type", "book")
      .eq("target_id", id)
      .eq("edge_type", "wrote")
      .single(),
  ]);

  let authorName = book.author;
  if (wroteEdge) {
    const { data: author } = await supabase
      .from("authors")
      .select("name")
      .eq("id", wroteEdge.source_id)
      .single();
    if (author) authorName = author.name;
  }

  const status = userEdge?.edge_type ?? null;
  const metadata = (userEdge?.metadata as Record<string, unknown>) ?? {};
  const rating = metadata.rating as number | undefined;
  const notes = metadata.notes as string | undefined;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link
        href="/universe"
        className="text-sm text-muted hover:text-foreground transition-colors mb-6 inline-block"
      >
        ← Back to Universe
      </Link>

      <div className="flex gap-6">
        <div className="w-32 h-44 shrink-0 rounded-lg bg-surface-solid border border-border/30 flex items-center justify-center overflow-hidden">
          {book.cover_url ? (
            <img
              src={book.cover_url}
              alt={book.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <BookOpen size={32} className="text-nav-inactive" />
          )}
        </div>

        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-foreground">
            {book.title}
          </h1>
          <p className="text-muted mt-1">{authorName}</p>

          {status && (
            <span
              className={`inline-block mt-3 text-xs px-3 py-1 rounded-full ${statusColors[status] ?? "bg-foreground/10 text-foreground"}`}
            >
              {statusLabels[status] ?? status}
            </span>
          )}

          {rating && (
            <p className="mt-3 text-sm text-accent">
              {"★".repeat(rating)}
              {"☆".repeat(5 - rating)}
            </p>
          )}

          {notes && (
            <p className="mt-3 text-sm text-muted italic">{notes}</p>
          )}
        </div>
      </div>

      <div className="mt-8 space-y-3">
        {book.publisher && (
          <p className="text-sm text-muted">
            <span className="text-foreground">Publisher:</span> {book.publisher}
          </p>
        )}
        {book.published_year && (
          <p className="text-sm text-muted">
            <span className="text-foreground">Published:</span>{" "}
            {book.published_year}
          </p>
        )}
        {book.page_count && (
          <p className="text-sm text-muted">
            <span className="text-foreground">Pages:</span> {book.page_count}
          </p>
        )}
        {book.isbn && (
          <p className="text-sm text-muted">
            <span className="text-foreground">ISBN:</span> {book.isbn}
          </p>
        )}
      </div>

      {book.description && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground mb-2">
            Description
          </h2>
          <p className="text-sm text-muted leading-relaxed">
            {book.description}
          </p>
        </div>
      )}
    </div>
  );
}
