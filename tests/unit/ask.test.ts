import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { askHope } from '@/lib/hope/ask'

// Lightweight window/CustomEvent stub so we don't need jsdom.
const events: { type: string; detail: { query: string } }[] = []

beforeEach(() => {
  events.length = 0
  ;(globalThis as Record<string, unknown>).CustomEvent = class {
    type: string; detail: { query: string }
    constructor(type: string, init?: { detail?: { query: string } }) { this.type = type; this.detail = init?.detail || { query: '' } }
  }
  ;(globalThis as Record<string, unknown>).window = { dispatchEvent: (e: { type: string; detail: { query: string } }) => { events.push(e); return true } }
})
afterEach(() => {
  delete (globalThis as Record<string, unknown>).window
  delete (globalThis as Record<string, unknown>).CustomEvent
})

describe('askHope', () => {
  it('dispatches a hope:ask event with the trimmed query', () => {
    askHope('  show me reach  ')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('hope:ask')
    expect(events[0].detail.query).toBe('show me reach')
  })

  it('no-ops on an empty / whitespace query', () => {
    askHope('')
    askHope('   ')
    expect(events).toHaveLength(0)
  })
})
