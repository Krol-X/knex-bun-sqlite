const Client_BetterSQLite3 = require('knex/lib/dialects/better-sqlite3');

/**
 * Knex dialect backed by Bun's built-in `bun:sqlite` driver.
 *
 * Extends Knex's `better-sqlite3` client and adapts the three places where
 * `bun:sqlite` differs:
 *   1. _driver()              — Database is a named export rather than the module itself
 *   2. acquireRawConnection() — omits `readonly: false` and empty option objects
 *   3. _query()               — uses `statement.columnNames` instead of `.reader` and finalizes statements
 *
 * `driverName` intentionally stays 'better-sqlite3' so Knex helpers such as
 * `db.fn.uuid()` recognize the dialect. `_packageName` is only used in error messages.
 */
class Client_BunSQLite3 extends Client_BetterSQLite3 {
  _packageName = 'bun:sqlite';

  _driver() {
    return require('bun:sqlite').Database;
  }

  async acquireRawConnection() {
    const options = this.connectionSettings.options || {};
    const safeIntegers = this._optSafeIntegers(options);

    const opts = {
      // Omit `readonly: false` and empty option objects for compatibility with bun:sqlite.
      ...(options.readonly ? { readonly: true } : {}),
      ...(safeIntegers === undefined ? {} : { safeIntegers }),
    };

    return Object.keys(opts).length
      ? new this.driver(this.connectionSettings.filename, opts)
      : new this.driver(this.connectionSettings.filename);
  }

  async _query(connection, obj) {
    if (!obj.sql) throw new Error('The query is empty');
    if (!connection) throw new Error('No connection provided');

    const statement = connection.prepare(obj.sql);
    try {
      const safeIntegers = this._optSafeIntegers(obj.options);
      if (safeIntegers !== undefined) statement.safeIntegers(safeIntegers);

      const bindings = this._formatBindings(obj.bindings);

      // SELECT / RETURNING statements expose columnNames; plain mutations do not.
      if (statement.columnNames.length > 0) {
        obj.response = statement.all(...bindings);
        return obj;
      }

      const result = statement.run(...bindings);
      obj.response = result;
      obj.context = { lastID: result.lastInsertRowid, changes: result.changes };

      return obj;
    } finally {
      statement.finalize();
    }
  }
}

Object.assign(Client_BunSQLite3.prototype, { driverName: 'better-sqlite3' });

/**
 * Load a native SQLite extension into the pooled Knex connection.
 * Assumes a single-connection SQLite pool (min: 1, max: 1).
 */
async function loadExtension(db, path) {
  const conn = await db.client.acquireConnection();
  try {
    conn.loadExtension(path);
  } finally {
    await db.client.releaseConnection(conn);
  }
  return db;
}

/**
 * Create a Knex instance configured with `Client_BunSQLite3`.
 */
function bunKnex(config) {
  const knexFactory = require('knex');
  return knexFactory({ ...config, client: Client_BunSQLite3 });
}

module.exports = Client_BunSQLite3;
module.exports.Client_BunSQLite3 = Client_BunSQLite3;
module.exports.loadExtension = loadExtension;
module.exports.bunKnex = bunKnex;
module.exports.default = Client_BunSQLite3;
