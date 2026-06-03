import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('ERROR: SUPABASE_DB_URL environment variable is not set.');
  process.exit(1);
}

const sql = readFileSync('supabase/migrations/011_students.sql', 'utf8');

// Split on semicolons but preserve $$ ... $$; blocks (functions, DO blocks)
const blocks = [];
let current = '';
let inDollarBlock = false;

for (const line of sql.split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('--') && !inDollarBlock && !current.trim()) continue;

  current += line + '\n';

  // Detect $$ block open (LANGUAGE plpgsql functions or DO $$)
  if (!inDollarBlock && (trimmed.includes('$$') && (trimmed.match(/\$\$/g) || []).length === 1)) {
    inDollarBlock = true;
    continue;
  }

  if (inDollarBlock) {
    if (trimmed.includes('$$')) {
      inDollarBlock = false;
      // If the closing $$ line ends the statement, push it
      if (trimmed.endsWith(';')) {
        blocks.push(current.trim());
        current = '';
      }
    }
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
const tmpFile = 'scripts/_tmp_students_block.sql';

for (let i = 0; i < blocks.length; i++) {
  const block = blocks[i];
  if (!block || block.startsWith('--')) continue;

  const preview = block.substring(0, 100).replace(/\n/g, ' ');
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
    if (stderr.includes('already exists') || stderr.includes('does not exist, skipping')) {
      console.log('SKIP');
      success++;
    } else {
      console.log('FAIL');
      console.log('  Error:', stderr.substring(0, 300));
      failed++;
    }
  }
}

try { unlinkSync(tmpFile); } catch {}

console.log(`\nDone: ${success} succeeded, ${failed} failed`);
if (failed > 0) process.exit(1);
