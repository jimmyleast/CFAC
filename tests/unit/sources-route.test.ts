import { describe, it, expect, vi, beforeEach } from 'vitest'
import { slugify } from '@/lib/util/slug'

describe('slugify', () => {
  it('lowercases, replaces non-alphanumerics, trims dashes', () => {
    expect(slugify('Collaborate Export!')).toBe('collaborate-export')
    expect(slugify('  Q1 — 2026 Sheet  ')).toBe('q1-2026-sheet')
    expect(slugify('A//B__C')).toBe('a-b-c')
  })
  it('returns empty for symbol-only input', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('')).toBe('')
  })
})

vi.mock('@/lib/auth/aal', () => ({ requireAdmin: vi.fn(), requireUserMfa: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { PATCH, POST } from '@/app/api/data/sources/route'
import { requireAdmin } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mAdminGate = requireAdmin as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

function adminMock({ existing, insertError, onInsert, onUpdate }: { existing: unknown; insertError?: unknown; onInsert?: (row: Record<string, unknown>) => void; onUpdate?: (row: Record<string, unknown>) => void }) {
  return {
    from: (table: string) => {
      if (table === 'data_sources') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing }) }) }),
          insert: async (row: Record<string, unknown>) => { onInsert?.(row); return { error: insertError || null } },
          update: (row: Record<string, unknown>) => {
            onUpdate?.(row)
            return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }) }
          },
        }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) } // components
    },
  }
}
const req = (body: unknown) => new Request('http://t/api/data/sources', { method: 'POST', body: JSON.stringify(body) })
const patchReq = (body: unknown) => new Request('http://t/api/data/sources', { method: 'PATCH', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mAdminGate.mockResolvedValue({ user: { id: 'admin1', email: 'a@cfac.org' } })
})

describe('POST /api/data/sources', () => {
  it('403s non-admin', async () => {
    const { NextResponse } = await import('next/server')
    mAdminGate.mockResolvedValue({ response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) })
    expect((await POST(req({ name: 'X' }))).status).toBe(403)
  })

  it('400s a missing or symbol-only name', async () => {
    mAdmin.mockReturnValue(adminMock({ existing: null }))
    expect((await POST(req({ name: '' }))).status).toBe(400)
    expect((await POST(req({ name: '!!!' }))).status).toBe(400)
  })

  it('409s a duplicate slug', async () => {
    mAdmin.mockReturnValue(adminMock({ existing: { id: 'dup' } }))
    const res = await POST(req({ name: 'Collaborate Export' }))
    expect(res.status).toBe(409)
  })

  it('creates a source and returns its slug', async () => {
    mAdmin.mockReturnValue(adminMock({ existing: null }))
    const res = await POST(req({ name: 'Collaborate Export', kind: 'system' }))
    expect(res.status).toBe(200)
    expect((await res.json()).slug).toBe('collaborate-export')
  })

  it('clamps an invalid kind to spreadsheet; honors a valid kind', async () => {
    let inserted: Record<string, unknown> = {}
    mAdmin.mockReturnValue(adminMock({ existing: null, onInsert: (r) => { inserted = r } }))
    await POST(req({ name: 'A', kind: "'; drop table" }))
    expect(inserted.kind).toBe('spreadsheet') // bogus → default
    await POST(req({ name: 'B', kind: 'form' }))
    expect(inserted.kind).toBe('form')
  })

  it('maps a unique-violation (race) to 409, not 500', async () => {
    mAdmin.mockReturnValue(adminMock({ existing: null, insertError: { code: '23505', message: 'dup' } }))
    const res = await POST(req({ name: 'Raced Source' }))
    expect(res.status).toBe(409)
  })

  it('updates an existing source profile', async () => {
    let updated: Record<string, unknown> = {}
    mAdmin.mockReturnValue(adminMock({
      existing: { id: 'src1', slug: 'education-sheet', source_profile_key: 'education_training_aggregate' },
      onUpdate: (row) => { updated = row },
    }))
    const res = await PATCH(patchReq({ slug: 'education-sheet', profileKey: 'education_training_aggregate' }))
    expect(res.status).toBe(200)
    expect(updated).toEqual({ source_profile_key: 'education_training_aggregate' })
    expect((await res.json()).profileKey).toBe('education_training_aggregate')
  })

  it('clears an existing source profile', async () => {
    let updated: Record<string, unknown> = {}
    mAdmin.mockReturnValue(adminMock({
      existing: { id: 'src1', slug: 'generic-source', source_profile_key: null },
      onUpdate: (row) => { updated = row },
    }))
    const res = await PATCH(patchReq({ slug: 'generic-source', profileKey: '' }))
    expect(res.status).toBe(200)
    expect(updated).toEqual({ source_profile_key: null })
  })

  it('rejects an unknown source profile on update', async () => {
    mAdmin.mockReturnValue(adminMock({ existing: { id: 'src1' } }))
    const res = await PATCH(patchReq({ slug: 'education-sheet', profileKey: 'bogus' }))
    expect(res.status).toBe(400)
  })
})
