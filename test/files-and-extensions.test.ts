import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Knex } from "knex";
import { bunKnex, loadExtension } from "knex-bun-sqlite3";

describe("file-backed databases and readonly mode", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "knex-bun-sqlite-"));
    dbPath = path.join(tmpDir, "test.sqlite");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("persists data to disk and reopens with string or object connection", async () => {
    const writer = bunKnex({
      connection: { filename: dbPath },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });

    try {
      await writer.schema.createTable("notes", (t) => {
        t.increments("id");
        t.string("body").notNullable();
        t.bigInteger("big_id").notNullable();
      });
      await writer("notes").insert({
        body: "persisted",
        big_id: 9007199254740993n,
      });
    } finally {
      await writer.destroy();
    }

    expect(fs.existsSync(dbPath)).toBe(true);

    const readerByString = bunKnex({
      connection: dbPath,
      useNullAsDefault: true,
    });
    try {
      const rows = await readerByString("notes").select("id", "body");
      expect(rows).toEqual([{ id: 1, body: "persisted" }]);
    } finally {
      await readerByString.destroy();
    }
  });

  test("readonly: true permits reads and rejects writes", async () => {
    const setup = bunKnex({
      connection: { filename: dbPath },
      useNullAsDefault: true,
    });
    try {
      await setup.schema.createTable("docs", (t) => {
        t.increments("id");
        t.string("title").notNullable();
        t.bigInteger("version").notNullable();
      });
      await setup("docs").insert({
        title: "handbook",
        version: 9007199254740995n,
      });
    } finally {
      await setup.destroy();
    }

    const ro = bunKnex({
      connection: {
        filename: dbPath,
        options: { readonly: true, safeIntegers: true },
      },
      useNullAsDefault: true,
    });

    try {
      const doc = await ro("docs").first();
      expect(doc).toEqual({
        id: 1n,
        title: "handbook",
        version: 9007199254740995n,
      });

      await expect(
        Promise.resolve(ro("docs").insert({ title: "blocked", version: 1 }))
      ).rejects.toThrow();

      await expect(
        Promise.resolve(
          ro("docs").where({ id: 1 }).update({ title: "blocked" })
        )
      ).rejects.toThrow();

      await expect(
        Promise.resolve(
          ro.schema.createTable("extra", (t) => {
            t.increments("id");
          })
        )
      ).rejects.toThrow();
    } finally {
      await ro.destroy();
    }
  });
});

describe("loadExtension", () => {
  test("acquires connection, calls conn.loadExtension(path), releases connection, and returns db", async () => {
    const events: string[] = [];
    const fakeConn = {
      loadExtension(extPath: string) {
        events.push(`load:${extPath}`);
      },
    };
    const fakeDb = {
      client: {
        async acquireConnection() {
          events.push("acquire");
          return fakeConn;
        },
        async releaseConnection(conn: unknown) {
          expect(conn).toBe(fakeConn);
          events.push("release");
        },
      },
    } as unknown as Knex;

    const returned = await loadExtension(fakeDb, "/opt/ext/vec0");
    expect(returned).toBe(fakeDb);
    expect(events).toEqual(["acquire", "load:/opt/ext/vec0", "release"]);
  });

  test("always releases connection when conn.loadExtension throws", async () => {
    const events: string[] = [];
    const fakeConn = {
      loadExtension() {
        events.push("load");
        throw new Error("cannot open shared object");
      },
    };
    const fakeDb = {
      client: {
        async acquireConnection() {
          events.push("acquire");
          return fakeConn;
        },
        async releaseConnection(conn: unknown) {
          expect(conn).toBe(fakeConn);
          events.push("release");
        },
      },
    } as unknown as Knex;

    await expect(
      loadExtension(fakeDb, "/bad/extension.so")
    ).rejects.toThrow("cannot open shared object");
    expect(events).toEqual(["acquire", "load", "release"]);
  });

  test("releases pooled connection on real db after failed extension load", async () => {
    const db = bunKnex({
      connection: ":memory:",
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });

    try {
      await expect(
        loadExtension(db, "/nonexistent/path/to/sqlite_extension")
      ).rejects.toThrow();

      // If the connection were leaked, the single-connection pool would hang here.
      const res = await db.raw("SELECT 1 + 1 AS sum");
      expect(res).toEqual([{ sum: 2 }]);
    } finally {
      await db.destroy();
    }
  });
});
