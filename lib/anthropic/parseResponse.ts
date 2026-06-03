import { SOPData } from '@/lib/types'

export function parseSOPFromResponse(text: string): SOPData | null {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/)
    if (!jsonMatch) return null
    
    const parsed = JSON.parse(jsonMatch[1])
    return parsed as SOPData
  } catch (e) {
    console.error('Failed to parse SOP JSON:', e)
    return null
  }
}
