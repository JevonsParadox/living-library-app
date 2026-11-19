/**
 * 01 — Download the latest ISFDB MySQL backup.
 *
 * Usage:
 *   # Via Google Drive URL (preferred — gets latest):
 *   npx tsx scripts/nebula/seed-top-10k/01-download.ts --url <drive-url>
 *
 *   # With the URL in ISFDB_DUMP_URL env var:
 *   ISFDB_DUMP_URL=<drive-url> npx tsx scripts/nebula/seed-top-10k/01-download.ts
 *
 *   # If you've already downloaded the dump manually:
 *   npx tsx scripts/nebula/seed-top-10k/01-download.ts --file path/to/backup.sql.gz
 *
 * Find the latest dump URL at: https://isfdb.org/wiki/index.php/ISFDB_Download_Script
 * (look for the Google Drive link to the most recent backup).
 *
 * The script:
 *   - Uses python3 -m gdown to pull from Drive (works around the large-file interstitial).
 *   - Decompresses .gz if needed, writes data/external/isfdb/<YYYY-MM-DD>/dump.sql.
 *   - Writes sha256.txt. Short-circuits if today's dump already exists with a matching checksum.
 *   - Logs a row into nb_external_source_runs.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, mkdirSync, statSync } from "fs";
import { readFile } from "fs/promises";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { resolve, dirname, basename } from "path";

config({ path: resolve(__dirname, "../../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TODAY = new Date().toISOString().slice(0, 10);
const DATA_DIR = resolve(__dirname, "../../../data/external/isfdb", TODAY);
const DUMP_PATH = resolve(DATA_DIR, "dump.sql");
const SHA_PATH = resolve(DATA_DIR, "sha256.txt");

function parseArgs(): { url?: string; file?: string; force?: boolean } {
  const args: { url?: string; file?: string; force?: boolean } = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--url=")) args.url = a.slice(6);
    else if (a === "--url") { /* placeholder; next slot */ }
    else if (a.startsWith("--file=")) args.file = a.slice(7);
    else if (a === "--force") args.force = true;
  }
  // Positional --url <value>:
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) args.url = argv[i + 1];
    else if (argv[i] === "--file" && argv[i + 1]) args.file = argv[i + 1];
  }
  if (!args.url) args.url = process.env.ISFDB_DUMP_URL;
  return args;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

function runCommand(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => { stdout += String(d); process.stdout.write(String(d)); });
    p.stderr.on("data", (d) => { stderr += String(d); process.stderr.write(String(d)); });
    p.on("close", (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

async function download(url: string, outPath: string): Promise<void> {
  console.log(`gdown ${url}`);
  const { code } = await runCommand("python3", ["-m", "gdown", url, "-O", outPath]);
  if (code !== 0) {
    throw new Error("gdown failed. Is it installed? Try: pip3 install --user gdown");
  }
}

async function maybeDecompress(inPath: string, outPath: string): Promise<void> {
  if (inPath.endsWith(".gz")) {
    console.log(`decompressing ${basename(inPath)} -> ${basename(outPath)}`);
    await pipeline(createReadStream(inPath), createGunzip(), createWriteStream(outPath));
  } else if (inPath !== outPath) {
    await pipeline(createReadStream(inPath), createWriteStream(outPath));
  }
}

async function logRun(
  status: "running" | "completed" | "failed" | "skipped_no_change",
  stats: Record<string, unknown>,
  errorText?: string,
): Promise<string> {
  const { data } = await supabase
    .from("nb_external_source_runs")
    .insert({
      provider: "isfdb_seed",
      version: TODAY,
      mode: "full",
      status,
      downloaded_at: status === "running" ? null : new Date().toISOString(),
      stats,
      error_text: errorText ?? null,
    })
    .select("id")
    .single();
  return (data?.id as string) ?? "";
}

async function main() {
  const args = parseArgs();
  mkdirSync(DATA_DIR, { recursive: true });

  // Fast path: dump already exists and we're not forcing.
  if (existsSync(DUMP_PATH) && !args.force) {
    const existingSha = await sha256File(DUMP_PATH);
    console.log(`dump already present at ${DUMP_PATH} (${(statSync(DUMP_PATH).size / 1e6).toFixed(1)} MB, sha256 ${existingSha.slice(0, 12)}…)`);

    const runId = await logRun("skipped_no_change", {
      dump_path: DUMP_PATH,
      sha256: existingSha,
      bytes: statSync(DUMP_PATH).size,
    });
    console.log(`logged run ${runId}`);
    return;
  }

  let rawDownloadPath: string;

  if (args.file) {
    if (!existsSync(args.file)) {
      throw new Error(`--file ${args.file} does not exist`);
    }
    rawDownloadPath = resolve(args.file);
  } else if (args.url) {
    rawDownloadPath = resolve(DATA_DIR, "dump.raw");
    await download(args.url, rawDownloadPath);
  } else {
    console.error("no --url / --file / ISFDB_DUMP_URL provided.");
    console.error("find the latest dump link at:");
    console.error("  https://isfdb.org/wiki/index.php/ISFDB_Download_Script");
    process.exit(2);
  }

  await maybeDecompress(rawDownloadPath, DUMP_PATH);

  const sha = await sha256File(DUMP_PATH);
  await (await import("fs/promises")).writeFile(SHA_PATH, `${sha}\n`);

  const bytes = statSync(DUMP_PATH).size;
  console.log(`\nwrote ${DUMP_PATH} (${(bytes / 1e6).toFixed(1)} MB, sha256 ${sha.slice(0, 12)}…)`);

  const runId = await logRun("completed", {
    dump_path: DUMP_PATH,
    sha256: sha,
    bytes,
  });
  console.log(`logged run ${runId}`);
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("download failed:", msg);
  await logRun("failed", { error: msg });
  process.exit(1);
});
