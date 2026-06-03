import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('ERROR: SUPABASE_DB_URL environment variable is not set.');
  process.exit(1);
}

const sql = readFileSync('supabase/migrations/004_discovery.sql', 'utf8');

// Split on semicolons but preserve DO $$ ... END $$; blocks
const blocks = [];
let current = '';
let inDollarBlock = false;

for (const line of sql.split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('--') && !inDollarBlock && !current.trim()) continue;

  current += line + '\n';

  if (trimmed.startsWith('DO $$') || trimmed === 'DO $$ BEGIN') {
    inDollarBlock = true;
  }

  if (inDollarBlock && trimmed === 'END $$;') {
    inDollarBlock = false;
    blocks.push(current.trim());
    current = '';
    continue;
  }

  if (!inDollarBlock && trimmed.endsWith(';') && !trimmed.startsWith('--')) {
    blocks.push(current.trim());
    current = '';
  }
}

if (current.trim()) blocks.push(current.trim());

console.log(`Found ${blocks.length} SQL blocks to execute\n`);

let success = 0;
let failed = 0;
const tmpFile = 'scripts/_tmp_block.sql';

for (let i = 0; i < blocks.length; i++) {
  const block = blocks[i];
  if (!block || block.startsWith('--')) continue;

  const preview = block.substring(0, 80).replace(/\n/g, ' ');
  process.stdout.write(`[${i + 1}/${blocks.length}] ${preview}... `);

  writeFileSync(tmpFile, block, 'utf8');

  try {
    execSync(
      `npx supabase db query --db-url "${dbUrl}" -f ${tmpFile}`,
      { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    console.log('OK');
    success++;
  } catch (err) {
    const stderr = (err.stderr || err.message || '').trim();
    if (stderr.includes('already exists')) {
      console.log('SKIP (already exists)');
      success++;
    } else {
      console.log('FAIL');
      console.log('  Error:', stderr.substring(0, 200));
      failed++;
    }
  }
}

try { unlinkSync(tmpFile); } catch {}

console.log(`\nDone: ${success} succeeded, ${failed} failed`);
if (failed > 0) process.exit(1);
