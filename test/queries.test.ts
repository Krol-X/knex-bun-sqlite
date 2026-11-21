import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Knex } from "knex";
import { bunKnex } from "knex-bun-sqlite3";

describe("CRUD and query execution", () => {
  let db: Knex;

  beforeEach(async () => {
    db = bunKnex({
      connection: ":memory:",
      useNullAsDefault: true,
    });

    await db.schema.createTable("items", (table) => {
      table.increments("id");
      table.string("name").notNullable();
      table.integer("qty").notNullable().defaultTo(0);
      table.boolean("active").notNullable().defaultTo(true);
      table.float("price");
      table.bigInteger("big_num");
      table.binary("payload");
      table.timestamp("created_at");
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("insert returns [lastInsertRowid] and supports batch inserts", async () => {
    const [firstId] = await db("items").insert({ name: "apple", qty: 3 });
    expect(firstId).toBe(1);

    const [secondId] = await db("items").insert({ name: "banana", qty: 5 });
    expect(secondId).toBe(2);

    await db("items").insert([
      { name: "cherry", qty: 10 },
      { name: "date", qty: 1 },
    ]);

    const rows = await db("items").select("id", "name", "qty").orderBy("id");
    expect(rows).toEqual([
      { id: 1, name: "apple", qty: 3 },
      { id: 2, name: "banana", qty: 5 },
      { id: 3, name: "cherry", qty: 10 },
      { id: 4, name: "date", qty: 1 },
    ]);
  });

  test("insert().returning() returns inserted rows", async () => {
    const insertedAll = await db("items")
      .insert({ name: "alpha", qty: 7 })
      .returning("*");
    expect(insertedAll).toHaveLength(1);
    expect(insertedAll[0]).toMatchObject({
      id: 1,
      name: "alpha",
      qty: 7,
      active: 1,
    });

    const insertedCols = await db("items")
      .insert([
        { name: "beta", qty: 8 },
        { name: "gamma", qty: 9 },
      ])
      .returning(["id", "name"]);
    expect(insertedCols).toEqual([
      { id: 2, name: "beta" },
      { id: 3, name: "gamma" },
    ]);
  });

  test("update returns affected row count and supports returning()", async () => {
    await db("items").insert([
      { name: "a", qty: 1 },
      { name: "b", qty: 2 },
      { name: "c", qty: 2 },
    ]);

    const changed = await db("items").where("qty", 2).update({ qty: 20 });
    expect(changed).toBe(2);

    const noMatch = await db("items").where("qty", 999).update({ qty: 1 });
    expect(noMatch).toBe(0);

    const returned = await db("items")
      .where({ name: "a" })
      .update({ name: "a-updated", qty: 10 })
      .returning(["id", "name", "qty"]);
    expect(returned).toEqual([{ id: 1, name: "a-updated", qty: 10 }]);
  });

  test("delete returns affected row count and raw DELETE ... RETURNING works", async () => {
    await db("items").insert([
      { name: "x", qty: 1 },
      { name: "y", qty: 2 },
      { name: "z", qty: 3 },
    ]);

    const deletedCount = await db("items").where("qty", ">=", 2).del();
    expect(deletedCount).toBe(2);

    const zeroDeleted = await db("items").where({ name: "missing" }).del();
    expect(zeroDeleted).toBe(0);

    const deletedRows = await db.raw(
      "DELETE FROM items WHERE name = ? RETURNING id, name",
      ["x"]
    );
    expect(deletedRows).toEqual([{ id: 1, name: "x" }]);
  });

  test("increment and decrement update counters and return affected count", async () => {
    await db("items").insert({ name: "stock", qty: 10 });

    const incChanges = await db("items")
      .where({ name: "stock" })
      .increment("qty", 5);
    expect(incChanges).toBe(1);

    const decChanges = await db("items")
      .where({ name: "stock" })
      .decrement("qty", 3);
    expect(decChanges).toBe(1);

    const row = await db("items").where({ name: "stock" }).first();
    expect(row.qty).toBe(12);
  });

  test("select helpers: first, pluck, count, orderBy, limit, offset, groupBy, having, CTE", async () => {
    await db("items").insert([
      { name: "a", qty: 10, active: true },
      { name: "b", qty: 20, active: true },
      { name: "c", qty: 30, active: false },
      { name: "d", qty: 40, active: false },
    ]);

    expect(await db("items").where({ name: "missing" }).first()).toBeUndefined();
    expect(await db("items").orderBy("id").pluck("name")).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);

    const [{ total }] = await db("items").count("* as total");
    expect(total).toBe(4);

    const page = await db("items")
      .select("name")
      .orderBy("qty", "desc")
      .limit(2)
      .offset(1);
    expect(page).toEqual([{ name: "c" }, { name: "b" }]);

    const grouped = await db("items")
      .select("active")
      .sum("qty as sum_qty")
      .groupBy("active")
      .havingRaw("sum(qty) > ?", [50]);
    expect(grouped).toEqual([{ active: 0, sum_qty: 70 }]);

    const cte = await db
      .with("high_qty", db("items").select("name", "qty").where("qty", ">=", 20))
      .from("high_qty")
      .select("name")
      .orderBy("qty");
    expect(cte).toEqual([{ name: "b" }, { name: "c" }, { name: "d" }]);
  });

  test("joins work across tables", async () => {
    await db.schema.createTable("tags", (table) => {
      table.increments("id");
      table.integer("item_id").notNullable();
      table.string("label").notNullable();
    });

    const [itemId] = await db("items").insert({ name: "laptop", qty: 2 });
    await db("tags").insert([
      { item_id: itemId, label: "electronics" },
      { item_id: itemId, label: "portable" },
    ]);

    const joined = await db("items")
      .join("tags", "items.id", "tags.item_id")
      .select("items.name", "tags.label")
      .orderBy("tags.label");
    expect(joined).toEqual([
      { name: "laptop", label: "electronics" },
      { name: "laptop", label: "portable" },
    ]);
  });

  test("onConflict ignore and merge", async () => {
    await db.schema.createTable("kv", (table) => {
      table.string("k").primary();
      table.string("v").notNullable();
    });

    await db("kv").insert({ k: "a", v: "1" });
    await db("kv").insert({ k: "a", v: "2" }).onConflict("k").ignore();
    expect(await db("kv").where({ k: "a" }).first()).toEqual({ k: "a", v: "1" });

    await db("kv").insert({ k: "a", v: "3" }).onConflict("k").merge();
    expect(await db("kv").where({ k: "a" }).first()).toEqual({ k: "a", v: "3" });
  });

  test("formats Date, boolean, Buffer, Uint8Array, null, float, and unicode bindings", async () => {
    const timestamp = new Date("2026-06-15T12:30:45.123Z");
    const blob = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

    await db("items").insert({
      name: "привет 🚀",
      qty: 1,
      active: false,
      price: 19.95,
      big_num: null,
      payload: blob,
      created_at: timestamp,
    });

    const row = await db("items").first();
    expect(row.name).toBe("привет 🚀");
    expect(row.active).toBe(0);
    expect(row.price).toBeCloseTo(19.95);
    expect(row.big_num).toBeNull();
    expect(Buffer.from(row.payload)).toEqual(blob);
    expect(row.created_at).toBe(timestamp.valueOf());
  });

  test("db.fn.uuid() generates valid v4 UUIDs (verifying driverName='better-sqlite3')", async () => {
    const r1 = await db.select({ id: db.fn.uuid() }).first();
    const r2 = await db.select({ id: db.fn.uuid() }).first();

    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(r1.id).toMatch(uuidV4);
    expect(r2.id).toMatch(uuidV4);
    expect(r1.id).not.toBe(r2.id);
  });

  test("PRAGMA queries work for both reading and writing settings", async () => {
    await db.raw("PRAGMA foreign_keys = ON");
    const fk = await db.raw("PRAGMA foreign_keys");
    expect(fk).toEqual([{ foreign_keys: 1 }]);
  });

  test("stream() yields all rows and emits error on invalid SQL", async () => {
    await db("items").insert([
      { name: "s1", qty: 1 },
      { name: "s2", qty: 2 },
      { name: "s3", qty: 3 },
    ]);

    const streamed: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = db("items").select("name").orderBy("id").stream();
      stream.on("data", (row: any) => streamed.push(row));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    expect(streamed).toEqual([{ name: "s1" }, { name: "s2" }, { name: "s3" }]);

    const streamError = await new Promise<Error>((resolve) => {
      const stream = db.raw("SELECT * FROM nonexistent_table_xyz").stream();
      stream.on("error", resolve);
    });
    expect(streamError).toBeInstanceOf(Error);
  });
});

describe("safeIntegers support", () => {
  const BEYOND_MAX_SAFE = 9007199254740993n; // 2^53 + 1

  test("connection-level safeIntegers: true returns bigint and allows per-query false override", async () => {
    const db = bunKnex({
      connection: {
        filename: ":memory:",
        options: { safeIntegers: true },
      },
      useNullAsDefault: true,
    });

    try {
      await db.schema.createTable("nums", (t) => {
        t.bigInteger("val").notNullable();
      });
      await db("nums").insert({ val: BEYOND_MAX_SAFE });

      const asBigInt = await db("nums").first();
      expect(typeof asBigInt.val).toBe("bigint");
      expect(asBigInt.val).toBe(BEYOND_MAX_SAFE);

      const asNumber = await db("nums")
        .options({ safeIntegers: false })
        .first();
      expect(typeof asNumber.val).toBe("number");
    } finally {
      await db.destroy();
    }
  });

  test("default connection returns number and allows per-query safeIntegers: true override", async () => {
    const db = bunKnex({
      connection: ":memory:",
      useNullAsDefault: true,
    });

    try {
      await db.schema.createTable("nums", (t) => {
        t.bigInteger("val").notNullable();
      });
      await db("nums").insert({ val: BEYOND_MAX_SAFE });

      const defaultRow = await db("nums").first();
      expect(typeof defaultRow.val).toBe("number");

      const safeRow = await db("nums")
        .options({ safeIntegers: true })
        .first();
      expect(typeof safeRow.val).toBe("bigint");
      expect(safeRow.val).toBe(BEYOND_MAX_SAFE);
    } finally {
      await db.destroy();
    }
  });
});
