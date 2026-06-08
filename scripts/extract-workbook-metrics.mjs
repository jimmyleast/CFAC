import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'

const XLSX = xlsx.default || xlsx
const repoRoot = process.cwd()
dotenv.config({ path: path.join(repoRoot, '.env.local'), quiet: true })

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const inputArg = args.find((arg) => arg !== '--apply') || process.env.WORKBOOK_DIR || path.join(repoRoot, '_private', 'workbooks')
const inputDir = path.resolve(inputArg)
const outputPath = path.join(repoRoot, '_private', 'workbook-metrics.json')

const MONTHS = {
  jan: '01', january: '01',
  feb: '02', february: '02', feburary: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12', decemeber: '12',
}
const MONTH_SHEETS = new Set(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEPT', 'SEP', 'OCT', 'NOV', 'DEC'])
const SOURCES = {
  cfacDashboard: { slug: 'cfac-dashboard-2026', name: 'CFAC Dashboard 2026', kind: 'spreadsheet', profileKey: null },
  carpDashboard: { slug: 'carp-dashboard-2026', name: 'CARP Dashboard 2026', kind: 'spreadsheet', profileKey: null },
  mentalHealthDashboard: { slug: 'mental-health-dashboard-2026', name: 'Mental Health Dashboard 2026', kind: 'spreadsheet', profileKey: null },
  residentialDashboard: { slug: 'residential-dashboard-2026', name: 'Residential Dashboard 2026', kind: 'spreadsheet', profileKey: null },
  education: { slug: 'education-sheet', name: 'Education Spreadsheet', kind: 'spreadsheet', profileKey: 'education_training_aggregate' },
  community: { slug: 'community-engagement', name: 'Community Engagement', kind: 'spreadsheet', profileKey: 'community_engagement_aggregate' },
  volunteers: { slug: 'volunteers-sheet', name: 'Volunteers Spreadsheet', kind: 'spreadsheet', profileKey: 'volunteers_aggregate' },
  xaya: { slug: 'xaya-sheet', name: 'Xaya Spreadsheet', kind: 'spreadsheet', profileKey: null },
  enrichment: { slug: 'enrichment-sheet', name: 'Enrichment Spreadsheet', kind: 'spreadsheet', profileKey: null },
  marketing: { slug: 'marketing-2026', name: 'Marketing 2026', kind: 'spreadsheet', profileKey: null },
  operations: { slug: 'operations-2026', name: 'Operations 2026', kind: 'spreadsheet', profileKey: null },
  hr: { slug: 'hr-isolved', name: 'HR (iSolved)', kind: 'system', profileKey: 'hr_aggregate' },
}

function text(value) {
  return String(value ?? '').trim()
}

function norm(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ')
}

function slugify(value) {
  return norm(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
}

function toNum(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(/[$,%\s,]/g, ''))
  return Number.isFinite(n) ? n : null
}

function excelDate(value) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 20_000 || n > 80_000) return null
  const utc = Math.round((n - 25569) * 86400 * 1000)
  return new Date(utc)
}

function periodFrom(value, context = '') {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return monthPeriod(value)
  const serialDate = excelDate(value)
  if (serialDate) return monthPeriod(serialDate)
  const raw = text(value)
  const parsed = raw ? new Date(raw) : null
  if (parsed && !Number.isNaN(parsed.getTime())) return monthPeriod(parsed)
  const joined = `${raw} ${context}`.trim()
  const y = joined.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || '2026'
  const token = joined.match(/\b(jan(?:uary)?|feb(?:ruary|urary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember|emeber)?)\b/i)?.[1]
  const month = token ? MONTHS[token.toLowerCase().slice(0, 3)] || MONTHS[token.toLowerCase()] : null
  return month ? { label: `${y}-${month}`, start: `${y}-${month}-01` } : { label: y, start: `${y}-01-01` }
}

function monthPeriod(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return { label: `${y}-${m}`, start: `${y}-${m}-01` }
}

function readSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '', raw: true })
}

function findHeader(rows, aliases) {
  const wanted = aliases.map(norm)
  const index = rows.findIndex((row) => {
    const labels = row.map(norm)
    return wanted.every((alias) => labels.includes(alias))
  })
  if (index < 0) return null
  return { index, header: rows[index].map(text) }
}

function col(header, aliases) {
  const labels = header.map(norm)
  for (const alias of aliases) {
    const i = labels.indexOf(norm(alias))
    if (i >= 0) return i
  }
  return -1
}

function addMetric(rows, source, metricKey, label, value, period, dimension = {}, unit = 'count') {
  const n = toNum(value)
  if (n === null || n === 0) return
  const dimKey = JSON.stringify(Object.entries(dimension).sort(([a], [b]) => a.localeCompare(b)))
  const found = rows.find((r) => r.sourceSlug === source.slug && r.metric_key === metricKey && r.period_label === period.label && JSON.stringify(Object.entries(r.dimension).sort(([a], [b]) => a.localeCompare(b))) === dimKey)
  if (found) found.value += n
  else rows.push({
    sourceSlug: source.slug,
    sourceName: source.name,
    sourceKind: source.kind,
    sourceProfileKey: source.profileKey,
    metric_key: metricKey,
    label,
    value: n,
    unit,
    period_label: period.label,
    period_start: period.start,
    dimension,
  })
}

function addPoint(rows, source, metricKey, label, value, period, dimension = {}, unit = 'count') {
  const n = toNum(value)
  if (n === null) return
  rows.push({
    sourceSlug: source.slug,
    sourceName: source.name,
    sourceKind: source.kind,
    sourceProfileKey: source.profileKey,
    metric_key: metricKey,
    label,
    value: n,
    unit,
    period_label: period.label,
    period_start: period.start,
    dimension,
  })
}

function bucket(value, fallback = 'Unspecified') {
  const s = text(value)
  return (s || fallback).slice(0, 80)
}

function sheetDimension(sheet, extra = {}) {
  return { workbook_sheet: sheet, ...extra }
}

function rowsAfterHeader(workbook, sheetName, aliases) {
  const rows = readSheet(workbook, sheetName)
  const hit = findHeader(rows, aliases)
  if (!hit) return { header: [], dataRows: [] }
  return { header: hit.header, dataRows: rows.slice(hit.index + 1) }
}

function periodFromHeader(value) {
  const label = text(value)
  if (!label) return null
  const lower = label.toLowerCase()
  if (lower.includes('year-to-date') || lower === 'ytd') return { label: '2026', start: '2026-01-01' }
  const q = lower.match(/\bq(?:tr)?\s*([1-4])\b/)
  if (q) {
    const starts = { 1: '01', 2: '04', 3: '07', 4: '10' }
    return { label: `2026-Q${q[1]}`, start: `2026-${starts[q[1]]}-01` }
  }
  return periodFrom(label, '2026')
}

function isPeriodHeader(value) {
  const label = norm(value)
  if (!label) return false
  if (label.includes('year-to-date') || label === 'ytd') return true
  if (/^q(?:tr)?\s*[1-4]$/.test(label)) return true
  return Boolean(MONTHS[label] || MONTHS[label.slice(0, 3)])
}

function isUnsafeLabel(label) {
  return /\b(name|contact information|notes?|tidbit|address|phone|email|dob|date of birth|ssn)\b/i.test(label)
}

function labelForRow(row, periodColumns) {
  for (let i = 0; i < row.length; i++) {
    if (periodColumns.has(i)) continue
    const label = text(row[i])
    if (!label) continue
    if (/^[\d\s,.$%():/-]+$/.test(label)) continue
    if (isUnsafeLabel(label)) return null
    return label.slice(0, 120)
  }
  return null
}

function extractDashboardTables(workbook, source, sheetNames, prefix) {
  const out = []
  for (const sheetName of sheetNames) {
    const before = out.length
    const rows = readSheet(workbook, sheetName)
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]
      const periodColumns = new Map()
      row.forEach((cell, colIndex) => {
        if (isPeriodHeader(cell)) periodColumns.set(colIndex, periodFromHeader(cell))
      })
      if (!periodColumns.size) continue
      for (let r = rowIndex + 1; r < rows.length; r++) {
        const current = rows[r]
        const label = labelForRow(current, periodColumns)
        if (!label) continue
        for (const [colIndex, period] of periodColumns.entries()) {
          if (!period) continue
          const value = toNum(current[colIndex])
          if (value === null) continue
          addPoint(
            out,
            source,
            `${prefix}_${slugify(sheetName)}_${slugify(label)}`,
            label,
            value,
            period,
            { workbook_sheet: sheetName, dashboard_row: label },
          )
        }
      }
      break
    }
    if (out.length === before) {
      const period = { label: '2026', start: '2026-01-01' }
      for (const row of rows) {
        const label = labelForRow(row, new Map())
        if (!label) continue
        row.forEach((cell, colIndex) => {
          const value = toNum(cell)
          if (value === null) return
          if (excelDate(cell)) return
          addPoint(
            out,
            source,
            `${prefix}_${slugify(sheetName)}_${slugify(label)}`,
            label,
            value,
            period,
            { workbook_sheet: sheetName, dashboard_row: label, cell_index: String(colIndex + 1) },
          )
        })
      }
    }
  }
  return out
}

function extractEducation(workbook) {
  const out = []
  for (const sheet of workbook.SheetNames.filter((s) => MONTH_SHEETS.has(s.toUpperCase()))) {
    const { header, dataRows } = rowsAfterHeader(workbook, sheet, ['Presentation', 'Total People'])
    if (!header.length) continue
    const presentationIdx = col(header, ['Presentation'])
    const countIdx = col(header, ['Count'])
    const peopleIdx = col(header, ['Total People'])
    const period = periodFrom('', `2026 ${sheet}`)
    for (const row of dataRows) {
      const presentation = bucket(row[presentationIdx])
      const count = toNum(row[countIdx]) ?? (presentation !== 'Unspecified' ? 1 : 0)
      addMetric(out, SOURCES.education, 'education_trainings_total', 'Education trainings', count, period, sheetDimension(sheet))
      addMetric(out, SOURCES.education, 'education_trainings_by_type', 'Education trainings by type', count, period, sheetDimension(sheet, { training_type: presentation }))
      addMetric(out, SOURCES.education, 'education_attendees', 'Education attendees', row[peopleIdx], period, sheetDimension(sheet))
    }
  }
  return out
}

function extractCommunity(workbook) {
  const out = []
  for (const sheet of ['Tours', 'Community Engagement']) {
    const required = sheet === 'Tours' ? ['Date', 'Tour Attendees'] : ['Date', 'Event Type', 'Event Attendees']
    const { header, dataRows } = rowsAfterHeader(workbook, sheet, required)
    if (!header.length) continue
    const dateIdx = col(header, ['Date'])
    const typeIdx = col(header, ['Event Type'])
    const attendIdx = col(header, ['Event Attendees', 'Tour Attendees'])
    const conversionIdx = col(header, ['Engagement Conversion'])
    for (const row of dataRows) {
      const period = periodFrom(row[dateIdx], '2026')
      const eventType = sheet === 'Tours' ? 'Tour' : bucket(row[typeIdx])
      const attendance = toNum(row[attendIdx])
      if (!attendance && !text(row[dateIdx])) continue
      addMetric(out, SOURCES.community, 'community_events_total', 'Community events', 1, period, sheetDimension(sheet))
      addMetric(out, SOURCES.community, 'community_events_by_type', 'Community events by type', 1, period, sheetDimension(sheet, { event_type: eventType }))
      addMetric(out, SOURCES.community, 'community_event_attendance', 'Community event attendance', attendance, period, sheetDimension(sheet))
      addMetric(out, SOURCES.community, 'community_conversions', 'Community conversions', row[conversionIdx], period, sheetDimension(sheet))
    }
  }
  const partnerships = rowsAfterHeader(workbook, 'Partnerships', ['Date Established', 'Partnership Type', 'Reach Value Assigned'])
  if (partnerships.header.length) {
    const dateIdx = col(partnerships.header, ['Date Established'])
    const typeIdx = col(partnerships.header, ['Partnership Type'])
    const reachIdx = col(partnerships.header, ['Reach Value Assigned'])
    for (const row of partnerships.dataRows) {
      const period = periodFrom(row[dateIdx], '2026')
      const type = bucket(row[typeIdx], 'Partnership')
      if (!text(row[dateIdx]) && !toNum(row[reachIdx])) continue
      addMetric(out, SOURCES.community, 'community_partnerships_total', 'Community partnerships', 1, period, sheetDimension('Partnerships', { partnership_type: type }))
      addMetric(out, SOURCES.community, 'community_partnership_reach_value', 'Community partnership reach value', row[reachIdx], period, sheetDimension('Partnerships', { partnership_type: type }))
    }
  }
  return out
}

function extractVolunteers(workbook) {
  const out = []
  const configs = [
    { sheet: 'Individual Log', required: ['Date', 'Volunteer Type', 'Hours'], date: ['Date'], type: ['Volunteer Type'], volunteers: null, hours: ['Hours'] },
    { sheet: 'Group', required: ['Date of Project', '# of Volunteers', 'Total Hours'], date: ['Date of Project'], type: ['Volunteer Type'], volunteers: ['# of Volunteers'], hours: ['Total Hours', 'Project Hours'] },
    { sheet: 'Events', required: ['Date of Event', '# of Volunteers', 'Hours'], date: ['Date of Event'], type: ['Event Type'], volunteers: ['# of Volunteers'], hours: ['Hours'] },
  ]
  for (const cfg of configs) {
    const { header, dataRows } = rowsAfterHeader(workbook, cfg.sheet, cfg.required)
    if (!header.length) continue
    const dateIdx = col(header, cfg.date)
    const typeIdx = col(header, cfg.type)
    const volunteerIdx = cfg.volunteers ? col(header, cfg.volunteers) : -1
    const hoursIdx = col(header, cfg.hours)
    for (const row of dataRows) {
      const period = periodFrom(row[dateIdx], '2026')
      const type = bucket(row[typeIdx], cfg.sheet)
      const volunteers = volunteerIdx >= 0 ? toNum(row[volunteerIdx]) : (text(row[dateIdx]) || toNum(row[hoursIdx]) ? 1 : 0)
      if (!volunteers && !toNum(row[hoursIdx])) continue
      addMetric(out, SOURCES.volunteers, 'volunteer_entries_total', 'Volunteer entries', 1, period, sheetDimension(cfg.sheet))
      addMetric(out, SOURCES.volunteers, 'volunteers_total', 'Volunteers', volunteers, period, sheetDimension(cfg.sheet))
      addMetric(out, SOURCES.volunteers, 'volunteers_by_type', 'Volunteers by type', volunteers || 1, period, sheetDimension(cfg.sheet, { volunteer_type: type }))
      addMetric(out, SOURCES.volunteers, 'volunteer_hours', 'Volunteer hours', row[hoursIdx], period, sheetDimension(cfg.sheet), 'hours')
    }
  }
  return out
}

function extractXaya(workbook) {
  const out = []
  for (const sheet of workbook.SheetNames.filter((s) => MONTH_SHEETS.has(s.toUpperCase()))) {
    const { header, dataRows } = rowsAfterHeader(workbook, sheet, ['Date of Interaction', 'Type of Service', 'Total People'])
    if (!header.length) continue
    const dateIdx = col(header, ['Date of Interaction'])
    const typeIdx = col(header, ['Type of Service'])
    const peopleIdx = col(header, ['Total People'])
    const uniqueIdx = col(header, ['Unique Interaction\r\n"x"', 'Unique Interaction'])
    for (const row of dataRows) {
      const period = periodFrom(row[dateIdx], `2026 ${sheet}`)
      const type = bucket(row[typeIdx], 'Interaction')
      const people = toNum(row[peopleIdx])
      if (!people && !text(row[dateIdx])) continue
      addMetric(out, SOURCES.xaya, 'xaya_interactions_total', 'Xaya interactions', 1, period, sheetDimension(sheet, { service_type: type }))
      addMetric(out, SOURCES.xaya, 'xaya_people_total', 'Xaya people', people, period, sheetDimension(sheet, { service_type: type }))
      if (/x|yes|true|1/i.test(text(row[uniqueIdx]))) addMetric(out, SOURCES.xaya, 'xaya_unique_interactions', 'Xaya unique interactions', 1, period, sheetDimension(sheet, { service_type: type }))
    }
  }
  return out
}

function extractOperations(workbook) {
  const out = []
  const security = rowsAfterHeader(workbook, 'Security', ['Date', 'Type of Incident', 'Was Protocol Followed?', 'Resolved?'])
  if (security.header.length) {
    const dateIdx = col(security.header, ['Date'])
    const typeIdx = col(security.header, ['Type of Incident'])
    const protocolIdx = col(security.header, ['Was Protocol Followed?'])
    const resolvedIdx = col(security.header, ['Resolved?'])
    for (const row of security.dataRows) {
      const period = periodFrom(row[dateIdx], '2026')
      const type = bucket(row[typeIdx], 'Security')
      if (!text(row[dateIdx]) && type === 'Security') continue
      addMetric(out, SOURCES.operations, 'security_incidents_total', 'Security incidents', 1, period, sheetDimension('Security', { incident_type: type }))
      if (/yes|x|true|1/i.test(text(row[protocolIdx]))) addMetric(out, SOURCES.operations, 'security_protocol_followed', 'Security protocol followed', 1, period, sheetDimension('Security'))
      if (/yes|x|true|1/i.test(text(row[resolvedIdx]))) addMetric(out, SOURCES.operations, 'security_resolved', 'Security resolved', 1, period, sheetDimension('Security'))
    }
  }
  const supply = rowsAfterHeader(workbook, 'Supply Management', ['Date Assessed', 'Category', 'Quantity Received', 'Actual Cost'])
  if (supply.header.length) {
    const dateIdx = col(supply.header, ['Date Assessed'])
    const categoryIdx = col(supply.header, ['Category'])
    const qtyIdx = col(supply.header, ['Quantity Received'])
    const costIdx = col(supply.header, ['Actual Cost'])
    for (const row of supply.dataRows) {
      const period = periodFrom(row[dateIdx], '2026')
      const category = bucket(row[categoryIdx], 'Supply')
      if (!text(row[dateIdx]) && !toNum(row[qtyIdx]) && !toNum(row[costIdx])) continue
      addMetric(out, SOURCES.operations, 'supply_assessments_total', 'Supply assessments', 1, period, sheetDimension('Supply Management', { category }))
      addMetric(out, SOURCES.operations, 'supply_quantity_received', 'Supply quantity received', row[qtyIdx], period, sheetDimension('Supply Management', { category }))
      addMetric(out, SOURCES.operations, 'supply_actual_cost', 'Supply actual cost', row[costIdx], period, sheetDimension('Supply Management', { category }), 'usd')
    }
  }
  const fleet = rowsAfterHeader(workbook, 'Fleet Management', ['Date of Maintenance Service', 'Vehicle Type', 'Maintenance Type', 'Actual Cost'])
  if (fleet.header.length) {
    const dateIdx = col(fleet.header, ['Date of Maintenance Service'])
    const vehicleIdx = col(fleet.header, ['Vehicle Type'])
    const typeIdx = col(fleet.header, ['Maintenance Type'])
    const costIdx = col(fleet.header, ['Actual Cost'])
    for (const row of fleet.dataRows) {
      const period = periodFrom(row[dateIdx], '2026')
      const vehicleType = bucket(row[vehicleIdx], 'Vehicle')
      const maintenanceType = bucket(row[typeIdx], 'Maintenance')
      if (!text(row[dateIdx]) && !toNum(row[costIdx])) continue
      addMetric(out, SOURCES.operations, 'fleet_maintenance_services_total', 'Fleet maintenance services', 1, period, sheetDimension('Fleet Management', { vehicle_type: vehicleType, maintenance_type: maintenanceType }))
      addMetric(out, SOURCES.operations, 'fleet_maintenance_actual_cost', 'Fleet maintenance actual cost', row[costIdx], period, sheetDimension('Fleet Management', { vehicle_type: vehicleType, maintenance_type: maintenanceType }), 'usd')
    }
  }
  return out
}

function extractMarketing(workbook) {
  const out = []
  const projects = rowsAfterHeader(workbook, 'Projects', ['Date Requested', 'Category', 'Status', 'Complexity'])
  if (projects.header.length) {
    const dateIdx = col(projects.header, ['Date Requested'])
    const categoryIdx = col(projects.header, ['Category'])
    const statusIdx = col(projects.header, ['Status'])
    const complexityIdx = col(projects.header, ['Complexity'])
    const durationIdx = col(projects.header, ['Duration'])
    const weightIdx = col(projects.header, ['Weight'])
    for (const row of projects.dataRows) {
      const period = periodFrom(row[dateIdx], '2026')
      const category = bucket(row[categoryIdx], 'Project')
      const status = bucket(row[statusIdx], 'Unspecified')
      const complexity = bucket(row[complexityIdx], 'Unspecified')
      if (!text(row[dateIdx]) && category === 'Project') continue
      addMetric(out, SOURCES.marketing, 'marketing_projects_total', 'Marketing projects', 1, period, sheetDimension('Projects', { category, status, complexity }))
      addMetric(out, SOURCES.marketing, 'marketing_project_duration', 'Marketing project duration', row[durationIdx], period, sheetDimension('Projects', { category }), 'days')
      addMetric(out, SOURCES.marketing, 'marketing_project_weight', 'Marketing project weight', row[weightIdx], period, sheetDimension('Projects', { category }))
    }
  }
  return out
}

function extractHr(workbook) {
  const out = []
  const pending = rowsAfterHeader(workbook, 'pending - ignore', ['Month', 'Budgeted Positions', 'Starting Staff', 'Separations', 'New Hires', 'Ending Staff', 'Retention Rate'])
  if (!pending.header.length) return out
  const monthIdx = col(pending.header, ['Month'])
  const openIdx = col(pending.header, ['Budgeted Positions'])
  const separationsIdx = col(pending.header, ['Separations'])
  const retentionIdx = col(pending.header, ['Retention Rate'])
  const newHiresIdx = col(pending.header, ['New Hires'])
  const endingIdx = col(pending.header, ['Ending Staff'])
  for (const row of pending.dataRows) {
    const period = periodFrom(row[monthIdx], '2026')
    if (!text(row[monthIdx])) continue
    addMetric(out, SOURCES.hr, 'hr_open_positions', 'HR open positions', row[openIdx], period, sheetDimension('pending - ignore'))
    addMetric(out, SOURCES.hr, 'hr_turnover', 'HR turnover', row[separationsIdx], period, sheetDimension('pending - ignore'))
    addMetric(out, SOURCES.hr, 'hr_new_hires', 'HR new hires', row[newHiresIdx], period, sheetDimension('pending - ignore'))
    addMetric(out, SOURCES.hr, 'hr_ending_staff', 'HR ending staff', row[endingIdx], period, sheetDimension('pending - ignore'))
    addMetric(out, SOURCES.hr, 'hr_retention_rate', 'HR retention rate', row[retentionIdx], period, sheetDimension('pending - ignore'), 'percent')
  }
  return out
}

function extractEnrichment(workbook) {
  return extractDashboardTables(
    workbook,
    SOURCES.enrichment,
    ['Enrichment Log YTD', 'Enrichment Log QTR 1', 'Enrichment Log QTR 2', 'Enrichment Log QTR 3', 'Enrichment Log QTR 4'],
    'enrichment_dashboard',
  )
}

function loadWorkbook(fileName) {
  return XLSX.readFile(path.join(inputDir, fileName), { cellDates: false })
}

const allMetrics = []
const skipped = []
const skippedRawTabs = [
  { file: 'CARP_2026.xlsx', reason: 'Raw CARP/client tabs not loaded; dashboard aggregate tabs loaded.' },
  { file: 'Mental Health_2026.xlsx', reason: 'Raw Mental Health client/touchpoint/waitlist tabs not loaded; dashboard aggregate tabs loaded.' },
  { file: 'Residential_2026.xlsx', reason: 'Raw Residential client/inquiry tabs not loaded; dashboard aggregate tabs loaded.' },
]
skipped.push(...skippedRawTabs)

const extractors = [
  ['CFAC Dashboard_2026.xlsx', (wb) => extractDashboardTables(wb, SOURCES.cfacDashboard, ['Reach', 'Organizational Impact', 'Financial Health', 'Exception Report'], 'cfac_dashboard')],
  ['CARP_2026.xlsx', (wb) => extractDashboardTables(wb, SOURCES.carpDashboard, ['PULSE CHECK', 'YTD Dashboard'], 'carp_dashboard')],
  ['Mental Health_2026.xlsx', (wb) => extractDashboardTables(wb, SOURCES.mentalHealthDashboard, ['PULSE CHECK', 'Dashboard'], 'mental_health_dashboard')],
  ['Residential_2026.xlsx', (wb) => extractDashboardTables(wb, SOURCES.residentialDashboard, ['Dashboard', 'PULSE CHECK'], 'residential_dashboard')],
  ['Education_2026.xlsx', (wb) => [
    ...extractDashboardTables(wb, SOURCES.education, ['Dashboard'], 'education_dashboard'),
    ...extractEducation(wb),
  ]],
  ['Community Engagement_2026.xlsm', extractCommunity],
  ['Volunteer_2026.xlsx', (wb) => [
    ...extractDashboardTables(wb, SOURCES.volunteers, ['Dashboard'], 'volunteer_dashboard'),
    ...extractVolunteers(wb),
  ]],
  ['Xaya_2026.xlsx', (wb) => [
    ...extractDashboardTables(wb, SOURCES.xaya, ['Dashboard'], 'xaya_dashboard'),
    ...extractXaya(wb),
  ]],
  ['Operations_2026.xlsx', (wb) => [
    ...extractDashboardTables(wb, SOURCES.operations, ['PULSE CHECK', 'Maintenance Requests'], 'operations_dashboard'),
    ...extractOperations(wb),
  ]],
  ['Marketing_2026.xlsx', (wb) => [
    ...extractDashboardTables(wb, SOURCES.marketing, ['Dashboard', 'Summary'], 'marketing_dashboard'),
    ...extractMarketing(wb),
  ]],
  ['Human Resources_2026.xlsx', (wb) => [
    ...extractDashboardTables(wb, SOURCES.hr, ['Dashboard', 'Hiring', 'Staff'], 'hr_dashboard'),
    ...extractHr(wb),
  ]],
  ['Enrichment_2026.xlsx', extractEnrichment],
]

for (const [fileName, extractor] of extractors) {
  try {
    allMetrics.push(...extractor(loadWorkbook(fileName)))
  } catch (error) {
    skipped.push({ file: fileName, reason: error instanceof Error ? error.message : 'extract failed' })
  }
}

const sources = Array.from(new Map(Object.values(SOURCES).map((s) => [s.slug, s])).values())
const payload = {
  generatedAt: new Date().toISOString(),
  inputDir,
  apply,
  note: 'Aggregate metrics only. PHI/client-level workbooks and raw row values are not loaded.',
  sources,
  metrics: allMetrics,
  skipped,
  summary: {
    metricRows: allMetrics.length,
    bySource: allMetrics.reduce((acc, row) => {
      acc[row.sourceSlug] = (acc[row.sourceSlug] || 0) + 1
      return acc
    }, {}),
  },
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, JSON.stringify(payload, null, 2))
console.log(`Extracted ${allMetrics.length} aggregate metric row(s).`)
console.log(`Wrote ${outputPath}`)
for (const [slug, count] of Object.entries(payload.summary.bySource)) console.log(`${slug}: ${count}`)
for (const item of skipped) console.log(`Skipped ${item.file}: ${item.reason}`)

if (apply) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply')
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const sourceIds = new Map()
  for (const source of sources.filter((s) => allMetrics.some((m) => m.sourceSlug === s.slug))) {
    const { data: existing, error: findErr } = await supabase.from('data_sources').select('id').eq('slug', source.slug).maybeSingle()
    if (findErr) throw new Error(`source lookup failed for ${source.slug}: ${findErr.message}`)
    if (existing?.id) {
      sourceIds.set(source.slug, existing.id)
      continue
    }
    const { data: inserted, error: insertErr } = await supabase.from('data_sources').insert({
      slug: source.slug,
      name: source.name,
      kind: source.kind,
      description: 'Loaded from CFAC 2026 aggregate workbook extraction.',
      source_profile_key: source.profileKey,
    }).select('id').maybeSingle()
    if (insertErr) throw new Error(`source insert failed for ${source.slug}: ${insertErr.message}`)
    sourceIds.set(source.slug, inserted.id)
  }
  for (const source of sources.filter((s) => sourceIds.has(s.slug))) {
    const sourceMetrics = allMetrics
      .filter((m) => m.sourceSlug === source.slug)
      .map((m) => ({
        source_id: sourceIds.get(source.slug),
        metric_key: m.metric_key,
        label: m.label,
        value: m.value,
        unit: m.unit,
        period_label: m.period_label,
        period_start: m.period_start,
        dimension: m.dimension,
      }))
    const { error } = await supabase.rpc('replace_source_metrics', { p_source_id: sourceIds.get(source.slug), p_rows: sourceMetrics })
    if (error) {
      if (!String(error.message || '').includes('coalesce')) throw new Error(`metrics load failed for ${source.slug}: ${error.message}`)
      console.log(`RPC swap unavailable for ${source.slug}; using service-role delete/insert fallback.`)
      const { error: deleteErr } = await supabase.from('metrics').delete().eq('source_id', sourceIds.get(source.slug))
      if (deleteErr) throw new Error(`metrics delete failed for ${source.slug}: ${deleteErr.message}`)
      for (let i = 0; i < sourceMetrics.length; i += 500) {
        const { error: insertErr } = await supabase.from('metrics').insert(sourceMetrics.slice(i, i + 500))
        if (insertErr) throw new Error(`metrics insert failed for ${source.slug}: ${insertErr.message}`)
      }
    }
    console.log(`Loaded ${sourceMetrics.length} metric row(s) for ${source.slug}`)
  }
}
