import type { Knex } from "knex";

export interface BunSqlite3ConnectionOptions {
  /** Open the database in read-only mode. Omit for writable connections. */
  readonly?: true;
  /** Return SQLite INTEGER values as `bigint`. */
  safeIntegers?: boolean;
}

export interface BunSqlite3Connection {
  filename?: string;
  options?: BunSqlite3ConnectionOptions;
}

export type BunKnexConfig = Omit<Knex.Config, "client"> & {
  connection: BunSqlite3Connection | string;
};

export declare class Client_BunSQLite3 extends Knex.Client {
  constructor(config: BunKnexConfig | Knex.Config);
}

/** Create a Knex instance configured with `Client_BunSQLite3`. */
export declare function bunKnex(config: BunKnexConfig): Knex;

/** Load a native SQLite extension into the pooled Knex connection. */
export declare function loadExtension(db: Knex, path: string): Promise<Knex>;

export default Client_BunSQLite3;
