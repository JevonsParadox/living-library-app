/**
 * Nebula Block 2, Step 1: Download Goodbooks-10k raw CSVs
 *
 * Downloads:
 * - books.csv from goodbooks-10k (10k books with metadata)
 * - book_tags.csv from goodbooks-10k (tag assignments)
 * - tags.csv from goodbooks-10k (tag name lookup)
 * - books_enriched.csv from goodbooks-10k-extended (descriptions, pages, genres)
 *
 * Usage: npx tsx scripts/nebula/download-goodbooks.ts
 */

import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const RAW_DIR = resolve(__dirname, "../../data/nebula/raw");

const FILES = [
  {
    name: "books.csv",
    url: "https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master/books.csv",
  },
  {
    name: "book_tags.csv",
    url: "https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master/book_tags.csv",
  },
  {
    name: "tags.csv",
    url: "https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master/tags.csv",
  },
  {
    name: "books_enriched.csv",
    url: "https://raw.githubusercontent.com/malcolmosh/goodbooks-10k-extended/master/books_enriched.csv",
  },
];

async function download() {
  for (const file of FILES) {
    const path = resolve(RAW_DIR, file.name);
    if (existsSync(path)) {
      console.log(`Skipping ${file.name} (already exists)`);
      continue;
    }

    console.log(`Downloading ${file.name}...`);
    const res = await fetch(file.url);
    if (!res.ok) {
      console.error(`Failed to download ${file.name}: ${res.status} ${res.statusText}`);
      continue;
    }

    const text = await res.text();
    writeFileSync(path, text, "utf-8");
    console.log(`  Saved ${file.name} (${(text.length / 1024).toFixed(0)} KB)`);
  }

  console.log("\nDone. Raw files saved to data/nebula/raw/");
}

download().catch(console.error);
