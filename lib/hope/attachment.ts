import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

const MAX_ATTACHMENT_CHARS = 8000

type AttachmentContext = {
  text: string | null
  note: string | null
}

function lowerName(fileName: string) {
  return fileName.toLowerCase()
}

function isTextLike(fileName: string, mimeType: string) {
  const name = lowerName(fileName)
  return mimeType.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv') || name.endsWith('.json') || name.endsWith('.xml') || name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.log')
}

function truncate(text: string) {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_ATTACHMENT_CHARS) return { text: trimmed, note: null }
  return { text: trimmed.slice(0, MAX_ATTACHMENT_CHARS), note: `Attachment text was truncated to the first ${MAX_ATTACHMENT_CHARS.toLocaleString()} characters.` }
}

function sheetToText(rows: any[][], sheetName: string) {
  const lines = rows
    .slice(0, 250)
    .map((row) => row.map((cell) => String(cell ?? '').trim()).filter(Boolean).join('\t'))
    .filter(Boolean)
  return lines.length ? `Sheet: ${sheetName}\n${lines.join('\n')}` : ''
}

export async function extractHopeAttachmentContext(file: File): Promise<AttachmentContext> {
  const name = file.name || 'attachment'
  const mimeType = (file.type || '').toLowerCase()
  const lower = lowerName(name)

  try {
    if (isTextLike(name, mimeType)) {
      const raw = await file.text()
      const { text, note } = truncate(raw)
      return { text: `File: ${name}\n${text}`, note }
    }

    if (lower.endsWith('.docx')) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await mammoth.extractRawText({ buffer })
      const { text, note } = truncate(result.value)
      return { text: `File: ${name}\n${text}`, note }
    }

    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const sheets = workbook.SheetNames.slice(0, 3)
      const sheetText = sheets
        .map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName]
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: '' }) as any[][]
          return sheetToText(rows, sheetName)
        })
        .filter(Boolean)
        .join('\n\n')
      const { text, note } = truncate(sheetText)
      return { text: `File: ${name}\n${text}`, note }
    }

    if (lower.endsWith('.pdf')) {
      const pdfParse = (await import('pdf-parse')).default as (data: Buffer) => Promise<{ text: string }>
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await pdfParse(buffer)
      const { text, note } = truncate(result.text)
      return { text: `File: ${name}\n${text}`, note }
    }

    return { text: null, note: 'Hope can accept this file, but it does not yet extract readable text from that document type.' }
  } catch {
    return { text: null, note: 'Hope could not read text from that file. Try a text, DOCX, spreadsheet, or PDF document.' }
  }
}