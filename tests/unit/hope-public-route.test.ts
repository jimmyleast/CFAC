import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/hope/providers', () => ({ generateAnthropic: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({
  emitAppEvent: vi.fn(async () => {}),
  elapsedMs: (start: number) => Math.max(0, Date.now() - start),
}))

import { POST } from '@/app/api/hope/public/route'
import { generateAnthropic } from '@/lib/hope/providers'

const mockGen = generateAnthropic as unknown as ReturnType<typeof vi.fn>

function req(message: string) {
  return new Request('https://app/api/hope/public', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200)}` },
    body: JSON.stringify({ message }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGen.mockResolvedValue('CFAC can help with advocacy, therapy, prevention, and residential support.')
})

describe('POST /api/hope/public', () => {
  it('answers general public CFAC questions through the LLM path', async () => {
    const res = await POST(req('What services does CFAC offer?'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'CFAC can help with advocacy, therapy, prevention, and residential support.' })
    expect(mockGen).toHaveBeenCalledTimes(1)
  })

  it('does not send structured PII to an LLM', async () => {
    const res = await POST(req('My child Jane has DOB 03/14/2015 and needs help with a case.'))
    expect(res.status).toBe(200)
    expect((await res.json()).message).toContain('cannot review personal case details')
    expect(mockGen).not.toHaveBeenCalled()
  })

  it('does not send personal case narratives to an LLM even without structured PII', async () => {
    const res = await POST(req('My daughter was abused and a detective told us to ask about the forensic interview.'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toContain('general CFAC guidance')
    expect(body.message).toContain('forensic interviews')
    expect(mockGen).not.toHaveBeenCalled()
  })

  it('gives deterministic reporting guidance for personal report questions', async () => {
    const res = await POST(req('I need to report abuse involving my child.'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toContain('1-844-SAVE-A-CHILD')
    expect(mockGen).not.toHaveBeenCalled()
  })
})
