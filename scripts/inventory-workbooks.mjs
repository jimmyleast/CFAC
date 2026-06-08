import fs from 'node:fs/promises'
import path from 'node:path'
import xlsx from 'xlsx'

const XLSX = xlsx.default || xlsx

const repoRoot = process.cwd()
const requestedInputDir = process.argv[2] || process.env.WORKBOOK_DIR || path.join(repoRoot, '_private', 'workbooks')
const inputDir = path.resolve(requestedInputDir)
const outputPath = path.join(repoRoot, '_private', 'workbook-inventory.json')
const allowed = new Set(['.xlsx', '.xls', '.xlsm', '.csv'])

function cellText(value) {
  return String(value ?? '').trim()
}

function isHeaderLabel(value) {
  const text = cellText(value)
  if (!text) return false
  if (/^[\d\s,.$%():/-]+$/.test(text)) return false
  if (/^\d/.test(text)) return false
  return /[A-Za-z]/.test(text)
}

function findHeader(rows) {
  const index = rows.findIndex((row) => Array.isArray(row) && row.filter(isHeaderLabel).length >= 2)
  if (index < 0) return { rowIndex: null, headers: [] }
  return {
    rowIndex: index + 1,
    headers: rows[index].map(cellText).filter(isHeaderLabel),
  }
}

async function listWorkbookFiles() {
  try {
    const entries = await fs.readdir(inputDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(inputDir, entry.name))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
}

async function inventoryWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const sheets = workbook.SheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: '',
    })
    const header = findHeader(rows)
    return {
      name: sheetName,
      headerRow: header.rowIndex,
      headers: header.headers,
      dataRowEstimate: header.rowIndex ? Math.max(0, rows.length - header.rowIndex) : 0,
    }
  })
  return {
    file: path.basename(filePath),
    sheets,
  }
}

const files = await listWorkbookFiles()
if (!files.length) {
  console.log(`No workbook files found in ${inputDir}`)
  console.log('Copy CFAC workbook copies there first. Do not point this project at non-CFAC project folders.')
  process.exit(0)
}

const inventory = {
  generatedAt: new Date().toISOString(),
  inputDir,
  note: 'Header/tab inventory only. Cell values are intentionally not exported.',
  workbooks: await Promise.all(files.map(inventoryWorkbook)),
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, JSON.stringify(inventory, null, 2))

console.log(`Inventoried ${inventory.workbooks.length} workbook(s).`)
console.log(`Wrote ${outputPath}`)
