import fs from 'node:fs/promises'
import path from 'node:path'
import xlsx from 'xlsx'

const XLSX = xlsx.default || xlsx
const repoRoot = process.cwd()
const requestedInputDir = process.argv[2] || process.env.WORKBOOK_DIR || path.join(repoRoot, '_private', 'workbooks')
const inputDir = path.resolve(requestedInputDir)
const outputPath = path.join(repoRoot, '_private', 'workbook-formulas.json')
const allowed = new Set(['.xlsx', '.xls', '.xlsm'])

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

function formulaKind(formula) {
  const f = String(formula || '').toUpperCase()
  if (f.includes('VLOOKUP') || f.includes('XLOOKUP') || f.includes('INDEX') || f.includes('MATCH')) return 'lookup'
  if (f.includes('COUNTIF') || f.includes('SUMIF') || f.includes('AVERAGEIF')) return 'conditional_aggregate'
  if (f.includes('COUNT') || f.includes('SUM') || f.includes('AVERAGE')) return 'aggregate'
  if (f.includes('IF(') || f.includes('IFS(')) return 'conditional'
  if (f.includes('PIVOT')) return 'pivot'
  return 'other'
}

function referencedSheets(formula) {
  const refs = new Set()
  const text = String(formula || '')
  for (const match of text.matchAll(/(?:'([^']+)'|([A-Za-z0-9 _-]+))!/g)) {
    const sheet = (match[1] || match[2] || '').trim()
    if (sheet) refs.add(sheet)
  }
  return Array.from(refs).sort()
}

function inventoryWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false, cellFormula: true })
  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const formulas = []
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!')) continue
      if (!cell || typeof cell !== 'object' || !cell.f) continue
      const formula = String(cell.f)
      formulas.push({
        cell: address,
        kind: formulaKind(formula),
        referencedSheets: referencedSheets(formula),
        formula,
      })
    }
    const byKind = formulas.reduce((acc, item) => {
      acc[item.kind] = (acc[item.kind] || 0) + 1
      return acc
    }, {})
    const outboundSheets = Array.from(new Set(formulas.flatMap((f) => f.referencedSheets))).sort()
    return {
      name: sheetName,
      formulaCount: formulas.length,
      byKind,
      outboundSheets,
      formulas,
    }
  })
  return {
    file: path.basename(filePath),
    formulaCount: sheets.reduce((sum, sheet) => sum + sheet.formulaCount, 0),
    sheets,
  }
}

const files = await listWorkbookFiles()
if (!files.length) {
  console.log(`No workbook files found in ${inputDir}`)
  process.exit(0)
}

const inventory = {
  generatedAt: new Date().toISOString(),
  inputDir,
  note: 'Formula inventory only. Formula strings and sheet/cell references are exported; cached cell values are not exported.',
  workbooks: files.map(inventoryWorkbook),
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, JSON.stringify(inventory, null, 2))

console.log(`Inventoried formulas in ${inventory.workbooks.length} workbook(s).`)
console.log(`Formula count: ${inventory.workbooks.reduce((sum, wb) => sum + wb.formulaCount, 0)}`)
console.log(`Wrote ${outputPath}`)
