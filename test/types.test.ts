import { describe, expect, test } from "bun:test";
import knex, { type Knex } from "knex";
import DefaultClient, {
  Client_BunSQLite3,
  bunKnex,
  loadExtension,
  type BunKnexConfig,
  type BunSqlite3Connection,
  type BunSqlite3ConnectionOptions,
} from "@krol-x/knex-bun-sqlite";

describe("TypeScript types", () => {
  test("bunKnex accepts string and object connections and returns Knex", async () => {
    const dbFromString: Knex = bunKnex({
      connection: ":memory:",
      useNullAsDefault: true,
    });
    await dbFromString.destroy();

    const options: BunSqlite3ConnectionOptions = {
      readonly: true,
      safeIntegers: true,
    };
    const conn: BunSqlite3Connection = {
      filename: ":memory:",
      options,
    };
    const config: BunKnexConfig = {
      connection: conn,
      useNullAsDefault: true,
    };

    const dbFromConfig: Knex = bunKnex({
      ...config,
      connection: { filename: ":memory:", options: { safeIntegers: false } },
    });
    await dbFromConfig.destroy();

    expect(DefaultClient).toBe(Client_BunSQLite3);
  });

  test("Client_BunSQLite3 can be passed directly to knex()", async () => {
    const db: Knex = knex({
      client: Client_BunSQLite3,
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    const res = await db.raw("SELECT 1 as ok");
    expect(res).toEqual([{ ok: 1 }]);
    await db.destroy();
  });

  test("readonly: false is rejected by types", () => {
    const _bad: BunSqlite3ConnectionOptions = {
      // @ts-expect-error bun:sqlite rejects readonly: false
      readonly: false,
    };
    expect(_bad).toBeDefined();
  });

  test("loadExtension signature returns Promise<Knex>", () => {
    const fn: (db: Knex, path: string) => Promise<Knex> = loadExtension;
    expect(typeof fn).toBe("function");
  });
});
