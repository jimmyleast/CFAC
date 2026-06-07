import { describe, it, expect } from 'vitest'
import { deriveAgenda, canMove, isCaseStatus, AGENDAS } from '@/lib/casereview/agenda'

describe('deriveAgenda', () => {
  it('buckets by status', () => {
    expect(deriveAgenda('new')).toBe('new')
    expect(deriveAgenda('pending')).toBe('pending')
    expect(deriveAgenda('criminal')).toBe('criminal')
    expect(deriveAgenda('closed')).toBeNull()
  })
  it('routes to criminal on prosecution keywords regardless of status', () => {
    expect(deriveAgenda('new', 'AO was arrested last week')).toBe('criminal')
    expect(deriveAgenda('pending', 'no charges filed')).toBe('criminal')
    expect(deriveAgenda('new', 'warrant issued')).toBe('criminal')
  })
  it('stays on its agenda without keywords', () => {
    expect(deriveAgenda('pending', 'ongoing CPS assessment')).toBe('pending')
    expect(deriveAgenda('new', 'initial intake')).toBe('new')
  })
})

describe('canMove (human-in-the-loop transitions)', () => {
  it('allows valid moves', () => {
    expect(canMove('new', 'pending')).toBe(true)
    expect(canMove('pending', 'criminal')).toBe(true)
    expect(canMove('criminal', 'closed')).toBe(true)
    expect(canMove('closed', 'new')).toBe(true)
  })
  it('blocks invalid moves', () => {
    expect(canMove('new', 'new')).toBe(false)
    expect(canMove('closed', 'criminal')).toBe(false)
    expect(canMove('criminal', 'new')).toBe(false)
  })
})

describe('isCaseStatus + AGENDAS', () => {
  it('validates status strings', () => {
    expect(isCaseStatus('new')).toBe(true)
    expect(isCaseStatus('bogus')).toBe(false)
  })
  it('exposes the three agendas', () => {
    expect(AGENDAS.map((a) => a.key)).toEqual(['new', 'pending', 'criminal'])
  })
})
