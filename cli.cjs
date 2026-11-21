#!/usr/bin/env bun
'use strict';

/**
 * Обёртка над Knex CLI, гарантирующая запуск под Bun.
 *
 * Бинарник `knex/bin/cli.js` использует шебанг `#!/usr/bin/env node`, поэтому
 * `bunx knex ...` запускается в Node, где модуль `bun:sqlite` недоступен.
 */
const path = require('node:path');
const { createRequire } = require('node:module');

if (typeof Bun === 'undefined') {
  console.error(
    'knex-bun-sqlite3: this CLI must run on Bun (bun:sqlite is unavailable in Node).\n' +
      'Run it with `bunx knex-bun-sqlite3 <command>` or `bun run knex-bun-sqlite3 <command>`.'
  );
  process.exit(1);
}

function resolveKnexCli() {
  const fromCwd = createRequire(path.join(process.cwd(), 'package.json'));
  try {
    return fromCwd.resolve('knex/bin/cli.js');
  } catch {
    try {
      return require.resolve('knex/bin/cli.js');
    } catch {
      console.error(
        'knex-bun-sqlite3: could not find knex. Install it in your project with `bun add knex`.'
      );
      process.exit(1);
    }
  }
}

require(resolveKnexCli());
