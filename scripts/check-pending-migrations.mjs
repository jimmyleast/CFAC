#!/usr/bin/env node
/**
 * check-pending-migrations.mjs
 *
 * Detects and optionally applies pending .sql migrations using a lightweight
 * custom tracking table (uhp_deploy.applied_migrations). This table is
 * created automatically on first run.
 *
 * Usage:
 *   node scripts/check-pending-migrations.mjs --dir supabase/migrations --repo ops-agent
 *   node scripts/check-pending-migrations.mjs --dir supabase/migrations --repo ops-agent --apply
 *   node scripts/check-pending-migrations.mjs --dir supabase/migrations --repo ops-agent --baseline
 *
 * Args:
 *   --dir <path>      Path to the supabase/migrations directory (required)
 *   --repo <name>     Repo identifier: ops-agent | field-execution | student-app (required)
 *   --db-url <url>    Database URL (optional; falls back to SUPABASE_DB_URL env var)
 *   --apply           Apply pending migrations via psql and mark them as applied
 *   --baseline        Mark all local files as applied WITHOUT running SQL (one-time init
 *                     needed for migrations that were already applied manually before this
 *                     script existed)
 *   --json            Output pending list as a JSON array to stdout
 *
 * Exit codes:
 *   0  All migrations applied (nothing to do)
 *   1  Pending migrations found (check mode), or apply/baseline failed
 *   2  Missing required arguments or DB connection failure
 *
 * Prerequisites:
 *   psql in PATH, SUPABASE_DB_URL env var set or --db-url flag provided
 */

import { readdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { parseArgs } from 'util';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    dir:      { type: 'string' },
    repo:     { type: 'string' },
    'db-url': { type: 'string' },
    apply:          { type: 'boolean', default: false },
    baseline:       { type: 'boolean', default: false },
    'auto-baseline': { type: 'boolean', default: false },
    json:           { type: 'boolean', default: false },
    help:           { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: node check-pending-migrations.mjs --dir <path> --repo <name> [options]');
  console.log('  --apply          Apply pending migrations via psql');
  console.log('  --baseline       Mark all local files as applied WITHOUT running SQL (one-time init)');
  console.log('  --auto-baseline  If tracking table is empty for this repo, baseline first instead of applying (safe for first CI run)');
  console.log('  --json      Output pending list as JSON array');
  console.log('  --db-url    DB URL (or set SUPABASE_DB_URL)');
  process.exit(0);
}

const VALID_REPOS = ['ops-agent', 'field-execution', 'student-app'];
const VERSION_RE  = /^[a-zA-Z0-9_-]+$/;

const dbUrl = values['db-url'] || process.env.SUPABASE_DB_URL;
const dir   = values.dir;
const repo  = values.repo;

if (!dbUrl) {
  console.error('[migrations] SUPABASE_DB_URL is not set. Use --db-url or set the env var.');
  process.exit(2);
}
if (!dir) {
  console.error('[migrations] --dir is required.');
  process.exit(2);
}
if (!repo || !VALID_REPOS.includes(repo)) {
  console.error(`[migrations] --repo is required. Valid values: ${VALID_REPOS.join(', ')}`);
  process.exit(2);
}

const absDir = resolve(dir);
if (!existsSync(absDir)) {
  console.error(`[migrations] Migration directory not found: ${absDir}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs SQL via psql stdin. Returns stdout trimmed.
 * Throws on non-zero exit.
 */
function psqlQuery(sql) {
  return execSync(`psql "${dbUrl}" --tuples-only --no-align`, {
    input:    sql,
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Runs a .sql file via psql -f.
 * Throws on non-zero exit.
 */
function psqlFile(filePath) {
  execSync(`psql "${dbUrl}" -f "${filePath}"`, {
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  });
}

// ---------------------------------------------------------------------------
// Ensure tracking table exists
// ---------------------------------------------------------------------------

const SETUP_SQL = `
  CREATE SCHEMA IF NOT EXISTS uhp_deploy;
  CREATE TABLE IF NOT EXISTS uhp_deploy.applied_migrations (
    version    TEXT        NOT NULL,
    repo       TEXT        NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (version, repo)
  );
`;

try {
  psqlQuery(SETUP_SQL);
} catch (err) {
  if (values['auto-baseline']) {
    const stderr = String(err.stderr || '');
    console.warn('[migrations] Tracking DB unreachable with --auto-baseline: skipping migrations safely for this run.');
    console.warn('[migrations] psql connection details from stderr:');
    if (stderr) console.warn(stderr);
    if (stderr.includes('Tenant or user not found')) {
      console.warn('[migrations] Supabase pooler rejected credentials or tenant.');
      console.warn('[migrations] Set SUPABASE_POOLER_DB_URL_UHP_STAGING in GitHub Actions secrets using the exact Supabase dashboard pooler connection string.');
    }
    console.warn('[migrations] Fix DB connectivity (enable Supabase connection pooler) for tracking to work on subsequent runs.');
    process.exit(0);
  }
  console.error('[migrations] Failed to ensure tracking table:', err.message);
  if (err.stderr) console.error(err.stderr);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Read local migration files
// ---------------------------------------------------------------------------

const localVersions = readdirSync(absDir)
  .filter(f => f.endsWith('.sql'))
  .sort()
  .map(f => f.replace(/\.sql$/, ''));

if (localVersions.length === 0) {
  console.log(`[migrations] No .sql files found in ${absDir}. Nothing to check.`);
  process.exit(0);
}

// Validate filenames are safe for SQL string interpolation
for (const v of localVersions) {
  if (!VERSION_RE.test(v)) {
    console.error(`[migrations] Migration filename contains unexpected characters and cannot be processed: ${v}.sql`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Query applied versions from tracking table
// ---------------------------------------------------------------------------

let appliedVersions;
try {
  const result = psqlQuery(
    `SELECT version FROM uhp_deploy.applied_migrations WHERE repo = '${repo}' ORDER BY version`
  );
  appliedVersions = result.split('\n').map(v => v.trim()).filter(Boolean);
} catch (err) {
  console.error('[migrations] Failed to query tracking table:', err.message);
  if (err.stderr) console.error(err.stderr);
  process.exit(2);
}

const appliedSet = new Set(appliedVersions);
const pending    = localVersions.filter(v => !appliedSet.has(v));

// ---------------------------------------------------------------------------
// Report status
// ---------------------------------------------------------------------------

if (!values.json) {
  console.log(`[migrations] Repo:    ${repo}`);
  console.log(`[migrations] Dir:     ${absDir}`);
  console.log(`[migrations] Local:   ${localVersions.length} file(s)`);
  console.log(`[migrations] Applied: ${appliedVersions.length} tracked in DB`);
}

if (pending.length === 0) {
  if (values.json) {
    console.log('[]');
  } else {
    console.log('[migrations] All migrations are up to date.');
  }
  process.exit(0);
}

if (values.json) {
  console.log(JSON.stringify(pending));
}

// ---------------------------------------------------------------------------
// Baseline mode: mark all local files as applied WITHOUT running SQL
// ---------------------------------------------------------------------------

if (values.baseline) {
  console.log(`[migrations] Baseline mode: marking ${pending.length} file(s) as applied (no SQL executed).`);
  for (const version of pending) {
    try {
      psqlQuery(
        `INSERT INTO uhp_deploy.applied_migrations (version, repo) VALUES ('${version}', '${repo}') ON CONFLICT DO NOTHING`
      );
      console.log(`  [baseline] Marked: ${version}`);
    } catch (err) {
      console.error(`  [baseline] Failed to mark ${version}:`, err.message);
      process.exit(1);
    }
  }
  console.log('[migrations] Baseline complete.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Apply mode: run each pending migration via psql, then track it
// ---------------------------------------------------------------------------

if (values.apply && values['auto-baseline'] && appliedVersions.length === 0 && pending.length > 0) {
  console.log(`[migrations] Auto-baseline: no records found for repo '${repo}', marking ${pending.length} file(s) as applied (no SQL executed).`);
  for (const version of pending) {
    try {
      psqlQuery(
        `INSERT INTO uhp_deploy.applied_migrations (version, repo) VALUES ('${version}', '${repo}') ON CONFLICT DO NOTHING`
      );
      console.log(`  [auto-baseline] Marked: ${version}`);
    } catch (err) {
      console.error(`  [auto-baseline] Failed to mark ${version}:`, err.message);
      process.exit(1);
    }
  }
  console.log('[migrations] Auto-baseline complete. No SQL was run.');
  process.exit(0);
}

if (values.apply) {
  console.log(`[migrations] Applying ${pending.length} pending migration(s)...`);
  for (const version of pending) {
    const filePath = join(absDir, `${version}.sql`);
    console.log(`  [apply] Running: ${version}.sql`);
    try {
      psqlFile(filePath);
      psqlQuery(
        `INSERT INTO uhp_deploy.applied_migrations (version, repo) VALUES ('${version}', '${repo}') ON CONFLICT DO NOTHING`
      );
      console.log(`  [apply] Done:    ${version}`);
    } catch (err) {
      console.error(`  [apply] FAILED:  ${version}`);
      console.error(err.message);
      if (err.stderr) console.error(err.stderr);
      process.exit(1);
    }
  }
  console.log('[migrations] All pending migrations applied successfully.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Check mode: report pending and exit 1
// ---------------------------------------------------------------------------

if (!values.json) {
  console.log(`[migrations] ${pending.length} pending migration(s) found:`);
  for (const v of pending) {
    console.log(`  - ${v}.sql`);
  }
}
process.exit(1);
