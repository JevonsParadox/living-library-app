/**
 * 02 — Start a local MySQL 8 container and restore the ISFDB dump into it.
 *
 * Idempotent: if the container is already running and the `titles` table is
 * populated, this is a no-op.
 *
 * Usage: npx tsx scripts/nebula/seed-top-10k/02-load-mysql.ts
 *
 * Requires Docker Desktop running.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

const TODAY = new Date().toISOString().slice(0, 10);
const DUMP_PATH = resolve(__dirname, "../../../data/external/isfdb", TODAY, "dump.sql");
const CONTAINER_NAME = "isfdb-mysql";
const MYSQL_PASS = "local";
const MYSQL_PORT = 3307;
const MYSQL_DB = "isfdb";

function runCommand(
  cmd: string,
  args: string[],
  opts: { input?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: [opts.input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d) => { stdout += String(d); });
    p.stderr?.on("data", (d) => { stderr += String(d); });
    p.on("close", (code) => res({ code: code ?? 0, stdout, stderr }));
    if (opts.input) {
      p.stdin?.end(opts.input);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function dockerAvailable(): Promise<boolean> {
  const r = await runCommand("docker", ["info"]);
  return r.code === 0;
}

async function containerState(): Promise<"running" | "stopped" | "absent"> {
  const r = await runCommand("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER_NAME]);
  if (r.code !== 0) return "absent";
  return r.stdout.trim() === "true" ? "running" : "stopped";
}

async function startContainer(): Promise<void> {
  console.log(`starting MySQL 8 container '${CONTAINER_NAME}' on port ${MYSQL_PORT}`);
  const r = await runCommand("docker", [
    "run", "-d",
    "--name", CONTAINER_NAME,
    "-p", `${MYSQL_PORT}:3306`,
    "-e", `MYSQL_ROOT_PASSWORD=${MYSQL_PASS}`,
    "-e", `MYSQL_DATABASE=${MYSQL_DB}`,
    // MariaDB 10.11 is a drop-in for MySQL 5.5-era dumps and has an ARM64
    // image (unlike mysql:5.7). Accepts the ISFDB dump without strict-mode fuss.
    "mariadb:10.11",
  ]);
  if (r.code !== 0) {
    throw new Error(`docker run failed: ${r.stderr}`);
  }
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 90_000;
  process.stdout.write("waiting for MySQL to be ready");
  while (Date.now() < deadline) {
    const r = await runCommand("docker", [
      "exec", CONTAINER_NAME,
      "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", `-p${MYSQL_PASS}`, "--silent",
    ]);
    if (r.code === 0) {
      process.stdout.write(" ready\n");
      return;
    }
    process.stdout.write(".");
    await sleep(2000);
  }
  throw new Error("MySQL did not become ready within 90s");
}

async function restore(dumpPath: string): Promise<void> {
  console.log(`restoring ${dumpPath} into ${MYSQL_DB}`);
  // Pipe the dump through docker exec to mysql client inside the container.
  // This avoids requiring a host-side mysql binary.
  const p = spawn(
    "docker",
    ["exec", "-i", CONTAINER_NAME, "mysql", `-uroot`, `-p${MYSQL_PASS}`, MYSQL_DB],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const { createReadStream } = await import("fs");
  const rs = createReadStream(dumpPath);
  await new Promise<void>((resolvePromise, reject) => {
    rs.pipe(p.stdin!);
    rs.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`mysql restore exited ${code}`));
    });
  });
}

async function titleCount(): Promise<number> {
  const r = await runCommand(
    "docker",
    [
      "exec", CONTAINER_NAME,
      "mysql", `-uroot`, `-p${MYSQL_PASS}`, MYSQL_DB,
      "-N", "-e", "SELECT COUNT(*) FROM titles WHERE title_ttype='NOVEL'",
    ],
  );
  if (r.code !== 0) return 0;
  return Number.parseInt(r.stdout.trim(), 10) || 0;
}

async function main() {
  if (!(await dockerAvailable())) {
    console.error("Docker daemon is not running. Start Docker Desktop and try again.");
    process.exit(2);
  }

  if (!existsSync(DUMP_PATH)) {
    console.error(`dump not found at ${DUMP_PATH}`);
    console.error("run 01-download.ts first");
    process.exit(2);
  }

  let state = await containerState();
  if (state === "absent") {
    await startContainer();
    await waitForReady();
  } else if (state === "stopped") {
    console.log(`starting existing container '${CONTAINER_NAME}'`);
    await runCommand("docker", ["start", CONTAINER_NAME]);
    await waitForReady();
  }

  const existingCount = await titleCount();
  if (existingCount > 100_000) {
    console.log(`MySQL already holds ${existingCount} NOVEL titles — skipping restore`);
    return;
  }

  await restore(DUMP_PATH);

  const count = await titleCount();
  console.log(`\nrestored. titles WHERE ttype='NOVEL' = ${count}`);
  if (count < 100_000) {
    console.error("sanity check failed: expected > 100k NOVEL rows");
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
