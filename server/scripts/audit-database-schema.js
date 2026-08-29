#!/usr/bin/env node

require('dotenv').config();
const { auditSchemas } = require('../src/services/schemaAuditService');
const mainDatabase = require('../src/config/database');
const competitorDatabase = require('../src/config/competitor-database');

function readArgument(name, fallback = null) {
  const prefix = `--${name}=`;
  const argument = process.argv
    .slice(2)
    .find((item) => item.startsWith(prefix));
  return argument
    ? argument.slice(prefix.length)
    : process.env[`npm_config_${name}`] || fallback;
}

async function closePools() {
  await Promise.allSettled([
    mainDatabase.pool.end(),
    competitorDatabase.pool.end(),
  ]);
}

async function main() {
  const target = readArgument('target', 'all');
  const json =
    process.argv.includes('--json') || process.env.npm_config_json === 'true';
  if (!['all', 'main', 'competitor'].includes(target)) {
    process.stderr.write('target必须是 all、main 或 competitor\n');
    process.exitCode = 2;
    return;
  }

  const result = await auditSchemas({ target });
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `schema=${result.status}, main=${result.main.status}(${result.main.differenceCount}), competitor=${result.competitor.status}(${result.competitor.differenceCount})\n`,
    );
    for (const currentTarget of target === 'all'
      ? ['main', 'competitor']
      : [target]) {
      for (const difference of result[currentTarget].differences || []) {
        process.stdout.write(
          `${currentTarget}: ${difference.kind} ${difference.table || '-'} ${
            difference.name
          }\n`,
        );
      }
      if (result[currentTarget].error) {
        process.stderr.write(
          `${currentTarget}: ${result[currentTarget].error}\n`,
        );
      }
    }
  }

  process.exitCode =
    result.status === 'ok' ? 0 : result.status === 'degraded' ? 1 : 2;
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  })
  .finally(closePools);
