import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import knex from "knex";
import DefaultExport, {
  Client_BunSQLite3,
  bunKnex,
  loadExtension,
} from "knex-bun-sqlite3";

const cjsExports = require("../index.cjs");

describe("exports and client metadata", () => {
  test("CommonJS and ESM exports expose identical references", async () => {
    const mjsExports = await import(
      new URL("../index.mjs", import.meta.url).href
    );
    expect(cjsExports).toBe(Client_BunSQLite3);
    expect(cjsExports.Client_BunSQLite3).toBe(Client_BunSQLite3);
    expect(cjsExports.default).toBe(Client_BunSQLite3);
    expect(DefaultExport).toBe(Client_BunSQLite3);
    expect(cjsExports.bunKnex).toBe(bunKnex);
    expect(cjsExports.loadExtension).toBe(loadExtension);
    expect(mjsExports.default).toBe(Client_BunSQLite3);
    expect(mjsExports.Client_BunSQLite3).toBe(Client_BunSQLite3);
    expect(mjsExports.bunKnex).toBe(bunKnex);
    expect(mjsExports.loadExtension).toBe(loadExtension);
  });

  test("client keeps driverName='better-sqlite3' and _packageName='bun:sqlite'", async () => {
    const db = bunKnex({
      connection: ":memory:",
      useNullAsDefault: true,
    });
    try {
      expect(db.client).toBeInstanceOf(Client_BunSQLite3);
      expect(db.client.driverName).toBe("better-sqlite3");
      expect(db.client._packageName).toBe("bun:sqlite");
      expect(db.client._driver()).toBe(Database);
    } finally {
      await db.destroy();
    }
  });

  test("works when passed directly to knex({ client: Client_BunSQLite3 })", async () => {
    const db = knex({
      client: Client_BunSQLite3,
      connection: ":memory:",
      useNullAsDefault: true,
    });
    try {
      const rows = await db.raw("SELECT 42 AS answer");
      expect(rows).toEqual([{ answer: 42 }]);
    } finally {
      await db.destroy();
    }
  });

  test("bunKnex overrides client field and preserves remaining config", async () => {
    const db = bunKnex({
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });
    try {
      expect(db.client).toBeInstanceOf(Client_BunSQLite3);
      expect(db.client.config.useNullAsDefault).toBe(true);
      expect(db.client.config.pool).toEqual({ min: 1, max: 1 });
    } finally {
      await db.destroy();
    }
  });
});

describe("acquireRawConnection option handling", () => {
  function createSpiedClient(connection: any) {
    const calls: unknown[][] = [];
    const client = new Client_BunSQLite3({
      client: Client_BunSQLite3,
      connection,
      useNullAsDefault: true,
    });
    (client as any).driver = function FakeDatabase(...args: unknown[]) {
      calls.push(args);
      return { close() {} };
    };
    return { client, calls };
  }

  test("omits options argument when no options are provided", async () => {
    const { client, calls } = createSpiedClient({ filename: ":memory:" });
    await client.acquireRawConnection();
    expect(calls).toEqual([[":memory:"]]);
    expect(calls[0]).toHaveLength(1);
  });

  test("omits options argument when options object is empty", async () => {
    const { client, calls } = createSpiedClient({
      filename: ":memory:",
      options: {},
    });
    await client.acquireRawConnection();
    expect(calls).toEqual([[":memory:"]]);
    expect(calls[0]).toHaveLength(1);
  });

  test("omits readonly when readonly is false", async () => {
    const { client, calls } = createSpiedClient({
      filename: "/tmp/example.sqlite",
      options: { readonly: false },
    });
    await client.acquireRawConnection();
    expect(calls).toEqual([["/tmp/example.sqlite"]]);
    expect(calls[0]).toHaveLength(1);
  });

  test("passes { readonly: true } when readonly is true", async () => {
    const { client, calls } = createSpiedClient({
      filename: "/tmp/example.sqlite",
      options: { readonly: true },
    });
    await client.acquireRawConnection();
    expect(calls).toEqual([["/tmp/example.sqlite", { readonly: true }]]);
  });

  test("passes { safeIntegers: true } and { safeIntegers: false }", async () => {
    const t = createSpiedClient({
      filename: ":memory:",
      options: { safeIntegers: true },
    });
    await t.client.acquireRawConnection();
    expect(t.calls).toEqual([[":memory:", { safeIntegers: true }]]);

    const f = createSpiedClient({
      filename: ":memory:",
      options: { safeIntegers: false },
    });
    await f.client.acquireRawConnection();
    expect(f.calls).toEqual([[":memory:", { safeIntegers: false }]]);
  });

  test("combines readonly: true with safeIntegers", async () => {
    const { client, calls } = createSpiedClient({
      filename: "/tmp/example.sqlite",
      options: { readonly: true, safeIntegers: true },
    });
    await client.acquireRawConnection();
    expect(calls).toEqual([
      ["/tmp/example.sqlite", { readonly: true, safeIntegers: true }],
    ]);
  });

  test("omits readonly: false while preserving safeIntegers", async () => {
    const { client, calls } = createSpiedClient({
      filename: "/tmp/example.sqlite",
      options: { readonly: false, safeIntegers: true },
    });
    await client.acquireRawConnection();
    expect(calls).toEqual([["/tmp/example.sqlite", { safeIntegers: true }]]);
  });

  test("ignores non-boolean safeIntegers values", async () => {
    const { client, calls } = createSpiedClient({
      filename: ":memory:",
      options: { safeIntegers: "yes" },
    });
    await client.acquireRawConnection();
    expect(calls).toEqual([[":memory:"]]);
  });
});

describe("_query guards", () => {
  test("throws when sql is empty", async () => {
    const client = new Client_BunSQLite3({
      client: Client_BunSQLite3,
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    const rawConn = await client.acquireRawConnection();
    try {
      await expect((client as any)._query(rawConn, { sql: "" })).rejects.toThrow(
        "The query is empty"
      );
    } finally {
      await client.destroyRawConnection(rawConn);
    }
  });

  test("throws when connection is missing", async () => {
    const client = new Client_BunSQLite3({
      client: Client_BunSQLite3,
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await expect(
      (client as any)._query(null, { sql: "SELECT 1" })
    ).rejects.toThrow("No connection provided");
  });

  test("finalizes prepared statement for reads, writes, and errors", async () => {
    const client = new Client_BunSQLite3({
      client: Client_BunSQLite3,
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });

    const finalizeCalls: string[] = [];
    const makeConn = (mode: "select" | "run" | "throw") => ({
      prepare() {
        return {
          columnNames: mode === "select" ? ["id"] : [],
          safeIntegers() {},
          all() {
            if (mode === "throw") throw new Error("read fail");
            return [{ id: 1 }];
          },
          run() {
            if (mode === "throw") throw new Error("write fail");
            return { lastInsertRowid: 7, changes: 1 };
          },
          finalize() {
            finalizeCalls.push(mode);
          },
        };
      },
    });

    await (client as any)._query(makeConn("select"), { sql: "SELECT 1" });
    await (client as any)._query(makeConn("run"), { sql: "INSERT INTO t VALUES (1)" });
    await expect(
      (client as any)._query(makeConn("throw"), { sql: "INSERT INTO t VALUES (1)" })
    ).rejects.toThrow("write fail");

    expect(finalizeCalls).toEqual(["select", "run", "throw"]);
  });
});
