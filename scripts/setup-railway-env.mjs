#!/usr/bin/env node
// setup-railway-env.mjs
// Reads a .env.<environment> file and sets all Railway env vars for all 3 UHP
// services in the target environment using the Railway CLI.
//
// Usage:
//   node scripts/setup-railway-env.mjs --environment "Staging - New"
//   node scripts/setup-railway-env.mjs --environment "Staging - New" --dry-run
//   node scripts/setup-railway-env.mjs --environment production
//
// Prerequisites:
//   - Railway CLI installed: npm i -g @railway/cli
//   - Logged in: railway login  (or RAILWAY_TOKEN set in shell)
//   - .env.<environment-slug> file present (e.g. .env.staging-new)
//     Copy from .env.staging.example and fill in all values.

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { parseArgs } from 'util';

// ─── Configuration ────────────────────────────────────────────────────────────
// Update these to match the exact service names in your Railway project.
const RAILWAY_PROJECT_ID = 'e1c3ea55-5867-4e18-9040-bee49b755394'; // uhp-ops project ID

const SERVICES = {
  ops:     'uhp-ops-agent',              // UHP-OPS-Agent service name in Railway
  field:   'uhp-field-execution',        // uhp-field-execution service name
  student: 'uhp-student-app',            // uhp-student-app service name
};

// Variables routed to each service.
// Keys listed here must appear in the .env.<environment> file.
const ROUTING = {
  // ── Shared: all 3 services ─────────────────────────────────────────────────
  all: [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'CRON_SECRET',
    'NODE_ENV',
  ],

  // ── OPS-Agent only ─────────────────────────────────────────────────────────
  ops: [
    'NEXT_PUBLIC_APP_URL_OPS',           // renamed in .env file to avoid clash; mapped to NEXT_PUBLIC_APP_URL
    'NEXT_PUBLIC_SITE_URL_OPS',          // mapped to NEXT_PUBLIC_SITE_URL
    'NEXT_PUBLIC_STUDENT_APP_URL',
    'NEXT_PUBLIC_FIELD_EXEC_URL',
    'ALLOWED_EMAIL_DOMAINS',
    'ADMIN_EMAIL',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'TWILIO_FROM_NUMBER',
    'SLACK_BOT_TOKEN',
    'SLACK_CHANNEL_OPS',
    'SLACK_CHANNEL_ISSUES',
    'SLACK_CHANNEL_URGENT',
    'SLACK_CHANNEL_TECH',
    'SLACK_SIGNING_SECRET',
    'HUBSPOT_PRIVATE_APP_TOKEN',
    'HEYGEN_API_KEY',
    'NEXT_PUBLIC_HEYGEN_AVATAR_ID',
    'NEXT_PUBLIC_HEYGEN_VOICE_ID',
    'NEXT_PUBLIC_HEYGEN_AVATAR_POOL',
    'NEXT_PUBLIC_HEYGEN_VOICE_POOL',
    'OPERATIVE_CORE_URL',
    'OPERATIVE_CORE_KEY',
    'OPERATIVE_COMMS_URL',
    'OPERATIVE_COMMS_KEY',
    'OPERATIVE_OPS_URL',
    'OPERATIVE_OPS_KEY',
    'OPERATIVE_DEPLOYMENT_ID',
  ],

  // ── field-execution only ────────────────────────────────────────────────────
  field: [
    'NEXT_PUBLIC_APP_URL_FIELD',         // mapped to NEXT_PUBLIC_APP_URL
    'UHP_OPS_AGENT_URL',
  ],

  // ── student-app only ───────────────────────────────────────────────────────
  student: [
    'NEXT_PUBLIC_APP_URL_STUDENT',       // mapped to NEXT_PUBLIC_APP_URL
    'NEXT_PUBLIC_SITE_URL_STUDENT',      // mapped to NEXT_PUBLIC_SITE_URL
    'UHP_OPS_AGENT_URL',
    'UHP_ENFORCE_ACTIVE_STUDENT',
  ],
};

// Per-service key renames: source key in .env file -> actual key set in Railway.
const RENAMES = {
  NEXT_PUBLIC_APP_URL_OPS:      'NEXT_PUBLIC_APP_URL',
  NEXT_PUBLIC_SITE_URL_OPS:     'NEXT_PUBLIC_SITE_URL',
  NEXT_PUBLIC_APP_URL_FIELD:    'NEXT_PUBLIC_APP_URL',
  NEXT_PUBLIC_APP_URL_STUDENT:  'NEXT_PUBLIC_APP_URL',
  NEXT_PUBLIC_SITE_URL_STUDENT: 'NEXT_PUBLIC_SITE_URL',
};
// ─────────────────────────────────────────────────────────────────────────────

const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    environment: { type: 'string' },
    'dry-run':   { type: 'boolean', default: false },
  },
  strict: false,
});

const environment = flags.environment;
const dryRun      = flags['dry-run'];

if (!environment) {
  console.error('ERROR: --environment <name> is required.');
  console.error('  Example: node scripts/setup-railway-env.mjs --environment "Staging - New"');
  process.exit(1);
}

// Derive the env file name slug from the environment name.
const envSlug    = environment.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const envFile    = `.env.${envSlug}`;
const exampleFile = '.env.staging.example';

if (!existsSync(envFile)) {
  console.error(`ERROR: Env file not found: ${envFile}`);
  console.error(`  Copy ${exampleFile} to ${envFile} and fill in all values.`);
  process.exit(1);
}

// Check Railway CLI is available.
try {
  execSync('railway --version', { stdio: 'pipe' });
} catch {
  console.error('ERROR: Railway CLI not found. Install with: npm i -g @railway/cli');
  console.error('  Then log in with: railway login');
  process.exit(1);
}

// Parse the .env file into a key/value map.
function parseEnvFile(filePath) {
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key   = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = value;
  }
  return env;
}

const env = parseEnvFile(envFile);
console.log(`\nLoaded ${Object.keys(env).length} vars from ${envFile}`);
console.log(`Target environment: "${environment}"`);
if (dryRun) console.log('DRY RUN — no changes will be made.\n');

// Build var sets for each service.
function buildVarsForService(serviceKey) {
  const keys = [...(ROUTING.all || []), ...(ROUTING[serviceKey] || [])];
  const pairs = [];
  const skipped = [];

  for (const key of keys) {
    const value = env[key];
    if (value === undefined || value === '') {
      skipped.push(key);
      continue;
    }
    const railwayKey = RENAMES[key] || key;
    pairs.push({ key: railwayKey, value });
  }

  return { pairs, skipped };
}

function setVars(serviceName, pairs) {
  if (pairs.length === 0) return;

  // Build `KEY=VALUE` args. Quote values to handle spaces and special chars.
  const args = pairs
    .map(({ key, value }) => `${key}=${JSON.stringify(value)}`)
    .join(' ');

  const cmd = `railway variables set ${args} --project ${RAILWAY_PROJECT_ID} --environment ${JSON.stringify(environment)} --service ${JSON.stringify(serviceName)}`;

  if (dryRun) {
    console.log(`  [DRY RUN] ${cmd.substring(0, 120)}...`);
    return;
  }

  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message || '').trim();
    throw new Error(`railway CLI error: ${msg}`);
  }
}

// Process each service.
let totalErrors = 0;

for (const [serviceKey, serviceName] of Object.entries(SERVICES)) {
  const { pairs, skipped } = buildVarsForService(serviceKey);

  console.log(`\n── ${serviceName} ──────────────────────────`);
  console.log(`  Setting  : ${pairs.length} var(s)`);
  if (skipped.length) console.log(`  Skipped  : ${skipped.join(', ')} (empty or missing)`);

  try {
    setVars(serviceName, pairs);
    console.log(`  Status   : ${dryRun ? 'DRY RUN OK' : 'OK'}`);
  } catch (err) {
    console.error(`  Status   : FAILED`);
    console.error(`  Error    : ${err.message}`);
    totalErrors++;
  }
}

console.log('\n' + '─'.repeat(50));
if (totalErrors > 0) {
  console.error(`\nFinished with ${totalErrors} error(s). Check output above.`);
  process.exit(1);
} else {
  console.log(`\nDone. ${Object.keys(SERVICES).length} service(s) configured in "${environment}".`);
  if (!dryRun) {
    console.log(`\nVerify with:`);
    for (const [, serviceName] of Object.entries(SERVICES)) {
      console.log(`  railway variables list --environment ${JSON.stringify(environment)} --service ${JSON.stringify(serviceName)}`);
    }
  }
}
