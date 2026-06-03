/**
 * Google Sheets API client for cohort data import.
 * Uses service account credentials from env vars.
 */

import { google } from 'googleapis'

export async function getSheetsClient() {
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!email || !key) {
    throw new Error('Google Sheets service account credentials not configured. Set GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY.')
  }

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })

  return google.sheets({ version: 'v4', auth })
}

export async function readSheet(sheetId: string, range?: string): Promise<string[][]> {
  const sheets = await getSheetsClient()
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: range || 'A1:Z1000',
  })
  return (response.data.values || []) as string[][]
}

/**
 * Auto-detect column mapping from header row.
 * Returns a map of SIS field name → column index.
 */
const COLUMN_KEYWORDS: Record<string, string[]> = {
  first_name: ['first name', 'first', 'fname'],
  last_name: ['last name', 'last', 'lname', 'surname'],
  full_name: ['name', 'full name', 'student name', 'veteran name'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'cell', 'mobile', 'telephone', 'phone number'],
  emergency_contact_name: ['emergency contact', 'emergency name', 'ec name', 'ice contact'],
  emergency_contact_phone: ['emergency phone', 'ec phone', 'ice phone', 'emergency number'],
  dietary_flags: ['allergy', 'allergies', 'dietary', 'diet', 'food restriction', 'dietary restriction'],
  health_disclosures: ['accommodation', 'accommodations', 'living', 'health', 'medical', 'disability'],
  arrival_details: ['flight', 'arrival', 'travel', 'arrive', 'flight info', 'travel details'],
  military_branch: ['branch', 'military', 'military branch', 'service branch'],
  program: ['program', 'course', 'track', 'certification'],
  gi_bill_type: ['gi bill', 'gi', 'chapter', 'va benefit'],
}

export interface ColumnMap {
  [sisField: string]: number // column index
}

export function detectColumns(headers: string[]): { mapped: ColumnMap; unmapped: string[] } {
  const mapped: ColumnMap = {}
  const unmapped: string[] = []

  headers.forEach((header, index) => {
    const lower = header.toLowerCase().trim()
    if (!lower) return

    let matched = false
    for (const [field, keywords] of Object.entries(COLUMN_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw) || kw.includes(lower))) {
        // Don't overwrite if already mapped (first match wins)
        if (!mapped[field]) {
          mapped[field] = index
          matched = true
        }
        break
      }
    }

    if (!matched) unmapped.push(header)
  })

  return { mapped, unmapped }
}

/**
 * Parse a row using the detected column map.
 * Returns a partial SIS student record.
 */
export function parseRow(row: string[], columnMap: ColumnMap): Record<string, string | null> {
  const get = (field: string) => {
    const idx = columnMap[field]
    return idx !== undefined && row[idx] ? row[idx].trim() : null
  }

  let firstName = get('first_name')
  let lastName = get('last_name')

  // If no separate first/last but there's a full name, split it
  if (!firstName && !lastName && columnMap.full_name !== undefined) {
    const fullName = get('full_name')
    if (fullName) {
      const parts = fullName.split(/\s+/)
      firstName = parts[0] || null
      lastName = parts.slice(1).join(' ') || null
    }
  }

  return {
    first_name: firstName,
    last_name: lastName,
    email: get('email'),
    phone: get('phone'),
    emergency_contact_name: get('emergency_contact_name'),
    emergency_contact_phone: get('emergency_contact_phone'),
    dietary_flags: get('dietary_flags'),
    health_disclosures: get('health_disclosures'),
    arrival_details: get('arrival_details'),
    military_branch: get('military_branch'),
    program: get('program'),
    gi_bill_type: get('gi_bill_type'),
  }
}
