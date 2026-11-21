# @krol-x/knex-bun-sqlite

A Knex.js dialect for Bun’s built-in `bun:sqlite` driver. It reuses Knex’s `better-sqlite3` dialect and adapts the differences in connection setup and query results.

> **Compatibility note:** this dialect extends Knex’s internal `better-sqlite3` client implementation. Knex does not currently expose a public extension API for this use case, so compatibility with new Knex releases is not guaranteed. The package currently targets Knex 3.x and Bun 1.4+ (`bun:sqlite`).

## Install

```sh
bun add @krol-x/knex-bun-sqlite knex
```

## Usage

```js
// CommonJS
const { bunKnex } = require('@krol-x/knex-bun-sqlite');

// or ESM
// import { bunKnex } from '@krol-x/knex-bun-sqlite';

const db = bunKnex({
  connection: { filename: './data.sqlite' },
  useNullAsDefault: true,
  pool: { min: 1, max: 1 },
});

await db.schema.createTable('items', (table) => {
  table.increments('id');
  table.string('name').notNullable();
});

const [id] = await db('items').insert({ name: 'hello' });
const items = await db('items').select('*');

await db.destroy();
```

`connection` accepts a filename string or `{ filename, options }`. Supported connection options are `readonly: true` and `safeIntegers: true`. Omit `readonly` when opening a writable database; Bun’s driver rejects `readonly: false`.

For a read-only database:

```js
const db = bunKnex({
  connection: { filename: './data.sqlite', options: { readonly: true } },
});
```

## SQLite extensions

Use `loadExtension()` to load an extension on the Knex connection. The helper assumes the SQLite pool uses exactly one connection, as in the example above.

```js
const { bunKnex, loadExtension } = require('@krol-x/knex-bun-sqlite');

const db = bunKnex({
  connection: { filename: './data.sqlite' },
  pool: { min: 1, max: 1 },
});

await loadExtension(db, '/absolute/path/to/extension');
```

The extension must be compatible with the SQLite library bundled with the installed Bun version. Loading native extensions is inherently platform- and binary-dependent.

## Migrations CLI

Knex’s built-in `knex` binary uses `#!/usr/bin/env node`, so running `bunx knex migrate:latest` executes under Node where `bun:sqlite` is unavailable. Use the bundled `knex-bun-sqlite` CLI wrapper to run any Knex CLI command under Bun:

```sh
bun run knex-bun-sqlite migrate:latest
bun run knex-bun-sqlite migrate:rollback
bun run knex-bun-sqlite seed:run
```

Example `knexfile.cjs`:

```js
const Client_BunSQLite3 = require('@krol-x/knex-bun-sqlite');

module.exports = {
  client: Client_BunSQLite3,
  connection: { filename: './data.sqlite' },
  useNullAsDefault: true,
};
```

## API

- `bunKnex(config)` — create a Knex instance using the Bun SQLite dialect.
- `Client_BunSQLite3` — the Knex client constructor, also the default export (CommonJS and ESM).
- `loadExtension(db, path)` — load a native SQLite extension into the pooled connection and return `db`.

## License

MIT
