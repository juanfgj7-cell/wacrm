import { describe, it, expect, vi, afterEach } from 'vitest'
import { triggerMeta, formatRelative } from './trigger-meta'

describe('triggerMeta', () => {
  it('returns the known label/pill for a real trigger type', () => {
    expect(triggerMeta('keyword_match')).toMatchObject({ label: 'Keyword Match' })
  })

  it('falls back to a generic pill instead of throwing on an unknown/legacy trigger', () => {
    const meta = triggerMeta('some_future_trigger_not_yet_added')
    expect(meta.label).toBe('some_future_trigger_not_yet_added')
    expect(meta.pillClass).toContain('slate')
  })
})

describe('formatRelative', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "never" for null/undefined/invalid input', () => {
    expect(formatRelative(null)).toBe('never')
    expect(formatRelative(undefined)).toBe('never')
    expect(formatRelative('not-a-date')).toBe('never')
  })

  it('buckets recent timestamps into just now / minutes / hours / days', () => {
    const now = new Date('2026-08-19T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    expect(formatRelative(new Date(now.getTime() - 30_000).toISOString())).toBe('just now')
    expect(formatRelative(new Date(now.getTime() - 5 * 60_000).toISOString())).toBe('5m ago')
    expect(formatRelative(new Date(now.getTime() - 3 * 3600_000).toISOString())).toBe('3h ago')
    expect(formatRelative(new Date(now.getTime() - 2 * 86_400_000).toISOString())).toBe('2d ago')
  })

  it('falls back to a locale date string once it is a month or older', () => {
    const now = new Date('2026-08-19T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const old = new Date(now.getTime() - 40 * 86_400_000).toISOString()
    expect(formatRelative(old)).toBe(new Date(old).toLocaleDateString())
  })
})
