# Book Capture System — Engineering Plan

## Overview

Four methods to build a library fast. All share a common ingestion pipeline and Open Library API client.

---

## Architecture

```
Capture Method (UI)
  → Open Library match (metadata enrichment)
    → Book Ingestion Pipeline (shared)
      → Supabase: book + author + edges + subjects
        → Constellation updates
```

### Shared components

**`lib/open-library.ts`** — API client:
- `searchBooks(query)` — search by title/author, returns rich results
- `lookupISBN(isbn)` — ISBN → full book metadata
- `mapSubjects(olSubjects)` — Open Library subjects → our 15 categories

**`lib/book-ingestion.ts`** — shared ingestion:
- `ingestBook(bookData, userId)` — creates: book record, author record, wrote edge, owns edge, belongs_to edges for subjects
- `ingestBooks(books[], userId)` — batch version
- Handles deduplication (skip if book with same title+author exists)

---

## Method 1: Search & Add

**Component:** `components/AddBookForm.tsx` (upgrade existing)

**Flow:**
1. User types in search field
2. Debounced (300ms) call to Open Library search API
3. Results dropdown: cover thumbnail + title + author + year
4. Tap result → call `ingestBook()` → toast confirmation
5. Constellation updates via `revalidatePath`

**No new server actions needed** — the ingestion pipeline handles everything.

---

## Method 2: Shelf Photo/Video Scan

### Camera Capture

**Component:** `components/CameraCapture.tsx`

Two modes:
- **Photo:** `<input type="file" accept="image/*" capture="environment">` for mobile, or `navigator.mediaDevices.getUserMedia` for desktop
- **Video:** Record up to 30s using MediaRecorder API. On stop, extract frames.

Frame extraction:
```
video blob → <video> element → seek to each 1.5s mark → draw to <canvas> → toBlob()
→ Compare consecutive frames (canvas pixel diff) → skip if <5% change
→ Return 8-15 unique frame blobs
```

### Spine Reading

**Server action:** `app/actions/scan-spine.ts`

```typescript
async function scanSpine(images: FormData): Promise<SpineResult[]>
```

- Extracts image blobs from FormData
- Sends to Claude Vision API (multi-image message)
- Prompt: "Read every book spine visible. Return JSON: [{title, author, confidence}]. Deduplicate across images."
- Returns parsed results

**Dependencies:** `@anthropic-ai/sdk` (server-side only)
**Env:** `ANTHROPIC_API_KEY`

### Matching & Review

**Component:** `components/ScanResults.tsx`

- Receives spine results from Claude
- For each `{title, author}`, fuzzy-match against Open Library
- Show: cover, title, author, match confidence, checkbox
- Unmatched items: show with "?" cover, allow manual search
- "Add X books" button → batch `ingestBooks()`

### Cost

~$0.01-0.03 per image for Claude Vision. Multi-image call (10 frames): ~$0.10-0.20.
Budget: ~$0.50-1.00 per full library scan (2000 books across 3-4 scans).

---

## Method 3: Barcode Scan

**Component:** `components/BarcodeScanner.tsx`

Uses `BarcodeDetector` API (available in Chrome, Safari). Polyfill: `@AcquiredProtocol/barcode-detector` for unsupported browsers.

**Flow:**
1. Open camera stream
2. Continuously detect barcodes (EAN-13 format for ISBNs)
3. On detection: `lookupISBN(isbn)` → show book details
4. Auto-add mode: automatically call `ingestBook()`, show toast, continue scanning
5. Running counter in overlay: "Added 14 books"
6. Debounce: ignore same ISBN for 3 seconds after detection

---

## Method 4: CSV Import

**Component:** `components/CsvImport.tsx`
**Server action:** `app/actions/import-csv.ts`

Goodreads CSV format:
```
Title, Author, ISBN, My Rating, Date Read, Bookshelves, ...
```

**Flow:**
1. File upload
2. Parse CSV client-side (no library needed — native `FileReader` + split)
3. Send parsed rows to server action
4. For each row: match against Open Library by ISBN (preferred) or title+author
5. Map Goodreads shelves: "read" → `read`, "currently-reading" → `reading`, "to-read" → `wishlist`, default → `owns`
6. Map Goodreads rating to edge metadata
7. Review screen (same as ScanResults but with Goodreads-specific columns)
8. Batch add

---

## Subject Auto-Assignment

When a book is added via any method, Open Library returns subjects like:
```
["Fiction", "Science fiction", "Space exploration", "Adventure"]
```

We map these to our 15 categories using keyword matching:
```
"science fiction" → "Science Fiction"
"philosophy" → "Philosophy"
"history" → "History"
...
```

If no subjects match, assign based on Fiction/Non-fiction classification.

This creates `belongs_to` edges automatically, so new books appear in the right constellation clusters immediately.

---

## Build Order

| Block | What | Depends on |
|---|---|---|
| 1 | Open Library client + ingestion pipeline | — |
| 2 | Search & Add upgrade | Block 1 |
| 3 | Camera capture component | — |
| 4 | Claude Vision spine reading | — |
| 5 | Shelf Scan complete flow | Blocks 1, 3, 4 |
| 6 | Barcode Scanner | Block 1 |
| 7 | CSV Import | Block 1 |

Blocks 1-2 first. Then 3+4 in parallel. Then 5. Then 6 and 7.

---

## Environment Variables

```
# Already have
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CLERK_SECRET_KEY=

# New
ANTHROPIC_API_KEY=          # For Claude Vision spine reading
```
