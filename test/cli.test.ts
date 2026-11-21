import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bunKnex } from "@krol-x/knex-bun-sqlite";

const repoRoot = path.resolve(import.meta.dir, "..");
const cliPath = path.join(repoRoot, "cli.cjs");

function runCmd(cmd: string[], cwd = repoRoot) {
  const proc = Bun.spawnSync(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

describe("knex-bun-sqlite CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "knex-bun-sqlite-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("exits with a helpful error when invoked under Node", () => {
    const nodeBin = Bun.which("node");
    if (!nodeBin) return;

    const res = runCmd([nodeBin, cliPath, "--version"]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("must run on Bun");
  });

  test("runs Knex CLI --version under Bun", () => {
    const res = runCmd(["bun", cliPath, "--version"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/Knex CLI version:/i);
  });

  test("runs migrate:latest, migrate:status, and migrate:rollback against a bun:sqlite knexfile", async () => {
    const migrationsDir = path.join(tmpDir, "migrations");
    const dbPath = path.join(tmpDir, "app.sqlite");
    const knexfilePath = path.join(tmpDir, "knexfile.cjs");

    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(
      knexfilePath,
      `const Client_BunSQLite3 = require(${JSON.stringify(path.join(repoRoot, "index.cjs"))});
module.exports = {
  client: Client_BunSQLite3,
  connection: { filename: ${JSON.stringify(dbPath)} },
  useNullAsDefault: true,
  migrations: { directory: ${JSON.stringify(migrationsDir)} },
};
`
    );

    fs.writeFileSync(
      path.join(migrationsDir, "20260101000000_create_widgets.cjs"),
      `exports.up = function (knex) {
  return knex.schema.createTable('widgets', (t) => {
    t.increments('id');
    t.string('name').notNullable();
  });
};
exports.down = function (knex) {
  return knex.schema.dropTable('widgets');
};
`
    );

    const latest = runCmd(
      ["bun", cliPath, "migrate:latest", "--knexfile", knexfilePath],
      tmpDir
    );
    expect(latest.exitCode).toBe(0);
    expect(latest.stdout).toContain("Batch 1 run: 1 migrations");

    const db = bunKnex({
      connection: { filename: dbPath },
      useNullAsDefault: true,
    });
    try {
      expect(await db.schema.hasTable("widgets")).toBe(true);
    } finally {
      await db.destroy();
    }

    const status = runCmd(
      ["bun", cliPath, "migrate:status", "--knexfile", knexfilePath],
      tmpDir
    );
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("20260101000000_create_widgets.cjs");

    const rollback = runCmd(
      ["bun", cliPath, "migrate:rollback", "--knexfile", knexfilePath],
      tmpDir
    );
    expect(rollback.exitCode).toBe(0);
    expect(rollback.stdout).toContain("Batch 1 rolled back: 1 migrations");

    const dbAfter = bunKnex({
      connection: { filename: dbPath },
      useNullAsDefault: true,
    });
    try {
      expect(await dbAfter.schema.hasTable("widgets")).toBe(false);
    } finally {
      await dbAfter.destroy();
    }
  });
});
