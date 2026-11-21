import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Knex } from "knex";
import { bunKnex } from "knex-bun-sqlite3";

describe("schema builder and DDL", () => {
  let db: Knex;

  beforeEach(() => {
    db = bunKnex({
      connection: ":memory:",
      useNullAsDefault: true,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("createTable, hasTable, hasColumn, alterTable (add/rename/drop), dropTable", async () => {
    expect(await db.schema.hasTable("users")).toBe(false);

    await db.schema.createTable("users", (table) => {
      table.increments("id");
      table.string("email").notNullable().unique();
      table.string("full_name");
      table.integer("age");
    });

    expect(await db.schema.hasTable("users")).toBe(true);
    expect(await db.schema.hasColumn("users", "email")).toBe(true);
    expect(await db.schema.hasColumn("users", "missing")).toBe(false);

    await db("users").insert({
      email: "alice@example.com",
      full_name: "Alice",
      age: 30,
    });

    await db.schema.alterTable("users", (table) => {
      table.string("role").notNullable().defaultTo("member");
    });
    expect(await db.schema.hasColumn("users", "role")).toBe(true);

    await db.schema.alterTable("users", (table) => {
      table.renameColumn("full_name", "display_name");
    });
    expect(await db.schema.hasColumn("users", "display_name")).toBe(true);
    expect(await db.schema.hasColumn("users", "full_name")).toBe(false);

    await db.schema.alterTable("users", (table) => {
      table.dropColumn("age");
    });
    expect(await db.schema.hasColumn("users", "age")).toBe(false);

    const row = await db("users").first();
    expect(row).toEqual({
      id: 1,
      email: "alice@example.com",
      display_name: "Alice",
      role: "member",
    });

    await db.schema.dropTable("users");
    expect(await db.schema.hasTable("users")).toBe(false);

    await db.schema.dropTableIfExists("users");
  });

  test("enforces unique and foreign key constraints", async () => {
    await db.raw("PRAGMA foreign_keys = ON");

    await db.schema.createTable("authors", (table) => {
      table.increments("id");
      table.string("name").notNullable().unique();
    });

    await db.schema.createTable("books", (table) => {
      table.increments("id");
      table
        .integer("author_id")
        .notNullable()
        .references("id")
        .inTable("authors")
        .onDelete("CASCADE");
      table.string("title").notNullable();
    });

    const [authorId] = await db("authors").insert({ name: "Ursula" });

    await expect(
      Promise.resolve(db("authors").insert({ name: "Ursula" }))
    ).rejects.toThrow();

    await expect(
      Promise.resolve(db("books").insert({ author_id: 999, title: "Orphan" }))
    ).rejects.toThrow();

    await db("books").insert({ author_id: authorId, title: "Earthsea" });
    await db("authors").where({ id: authorId }).del();
    expect(await db("books").select("*")).toEqual([]);
  });

  test("createView and dropView", async () => {
    await db.schema.createTable("orders", (table) => {
      table.increments("id");
      table.string("status").notNullable();
      table.integer("amount").notNullable();
    });

    await db("orders").insert([
      { status: "paid", amount: 100 },
      { status: "pending", amount: 50 },
      { status: "paid", amount: 250 },
    ]);

    await db.schema.createView("paid_orders", (view) => {
      view.columns(["id", "amount"]);
      view.as(db("orders").select("id", "amount").where({ status: "paid" }));
    });

    const paid = await db("paid_orders").orderBy("id");
    expect(paid).toEqual([
      { id: 1, amount: 100 },
      { id: 3, amount: 250 },
    ]);

    await db.schema.dropView("paid_orders");
  });
});

describe("transactions and savepoints", () => {
  let db: Knex;

  beforeEach(async () => {
    db = bunKnex({
      connection: ":memory:",
      useNullAsDefault: true,
    });
    await db.schema.createTable("accounts", (table) => {
      table.increments("id");
      table.string("owner").notNullable();
      table.integer("balance").notNullable();
    });
    await db("accounts").insert([
      { owner: "alice", balance: 100 },
      { owner: "bob", balance: 50 },
    ]);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("commits changes on success", async () => {
    await db.transaction(async (trx) => {
      await trx("accounts").where({ owner: "alice" }).decrement("balance", 30);
      await trx("accounts").where({ owner: "bob" }).increment("balance", 30);
    });

    const rows = await db("accounts").select("owner", "balance").orderBy("id");
    expect(rows).toEqual([
      { owner: "alice", balance: 70 },
      { owner: "bob", balance: 80 },
    ]);
  });

  test("rolls back changes when callback throws", async () => {
    await expect(
      Promise.resolve(
        db.transaction(async (trx) => {
          await trx("accounts")
            .where({ owner: "alice" })
            .decrement("balance", 30);
          throw new Error("boom");
        })
      )
    ).rejects.toThrow("boom");

    const alice = await db("accounts").where({ owner: "alice" }).first();
    expect(alice.balance).toBe(100);
  });

  test("supports manual transactionProvider commit and rollback", async () => {
    const trxProvider = db.transactionProvider();
    const trx = await trxProvider();
    await trx("accounts").where({ owner: "bob" }).increment("balance", 25);
    await trx.rollback();

    const bob = await db("accounts").where({ owner: "bob" }).first();
    expect(bob.balance).toBe(50);

    const trx2 = await db.transaction();
    await trx2("accounts").where({ owner: "bob" }).increment("balance", 25);
    await trx2.commit();

    const bobAfter = await db("accounts").where({ owner: "bob" }).first();
    expect(bobAfter.balance).toBe(75);
  });

  test("nested savepoints isolate inner rollback from outer transaction", async () => {
    await db.transaction(async (outer) => {
      await outer("accounts").where({ owner: "alice" }).increment("balance", 10);

      await expect(
        Promise.resolve(
          outer.transaction(async (inner) => {
            await inner("accounts")
              .where({ owner: "bob" })
              .increment("balance", 999);
            throw new Error("inner fail");
          })
        )
      ).rejects.toThrow("inner fail");
    });

    const rows = await db("accounts").select("owner", "balance").orderBy("id");
    expect(rows).toEqual([
      { owner: "alice", balance: 110 },
      { owner: "bob", balance: 50 },
    ]);
  });

  test("outer rollback reverts committed inner savepoint", async () => {
    await expect(
      Promise.resolve(
        db.transaction(async (outer) => {
          await outer.transaction(async (inner) => {
            await inner("accounts")
              .where({ owner: "alice" })
              .increment("balance", 50);
          });
          throw new Error("outer fail");
        })
      )
    ).rejects.toThrow("outer fail");

    const alice = await db("accounts").where({ owner: "alice" }).first();
    expect(alice.balance).toBe(100);
  });
});
