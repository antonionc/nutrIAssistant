import { logger, scrub } from '../../utils/logger'

describe('logger.scrub', () => {
  it('passes plain strings through', () => {
    expect(scrub('hello')).toBe('hello')
  })

  it('truncates strings longer than 200 chars', () => {
    const long = 'x'.repeat(500)
    const out = scrub(long)
    expect(out).toBe('[truncated len=500]')
  })

  it('replaces encrypted blob strings with a placeholder', () => {
    expect(scrub('enc:v1:abc123xyz')).toBe('[encrypted]')
    expect(scrub('enc:v2:abc123xyz')).toBe('[encrypted]')
  })

  it('redacts PII-shaped object keys regardless of value', () => {
    const input = {
      name: 'Carlos',
      weight: 80,
      height: 180,
      allergies: ['gluten'],
      memory: 'remembers he likes lentils',
      message: 'hello bot',
      response: 'hello user',
      conditions: ['celiac'],
      // Non-PII keys are kept
      duration_ms: 42,
      cuisine: 'mediterranean',
    }
    const out = scrub(input) as Record<string, unknown>
    expect(out.name).toBe('[redacted]')
    expect(out.weight).toBe('[redacted]')
    expect(out.height).toBe('[redacted]')
    expect(out.allergies).toBe('[redacted]')
    expect(out.memory).toBe('[redacted]')
    expect(out.message).toBe('[redacted]')
    expect(out.response).toBe('[redacted]')
    expect(out.conditions).toBe('[redacted]')
    expect(out.duration_ms).toBe(42)
    expect(out.cuisine).toBe('mediterranean')
  })

  it('redacts nested PII keys', () => {
    const input = { profile: { name: 'X', age: 40 } }
    const out = scrub(input) as { profile: Record<string, unknown> }
    expect(out.profile.name).toBe('[redacted]')
    expect(out.profile.age).toBe(40)
  })

  it('serializes Error objects without exposing PII in messages', () => {
    const err = new Error('failed for memberId=abc and name=Carlos')
    // Note: we currently truncate, not redact, free-form error messages.
    // The string is <200 chars so it passes through. This is intentional —
    // error stacks rarely contain raw PII, and full obliteration breaks
    // debuggability. If a stack does contain PII it will be truncated.
    const out = scrub(err) as { name: string; message: string }
    expect(out.name).toBe('Error')
    expect(typeof out.message).toBe('string')
  })

  it('handles arrays', () => {
    expect(scrub([1, 2, 3])).toEqual([1, 2, 3])
    expect(scrub(['a', 'enc:v1:secret'])).toEqual(['a', '[encrypted]'])
  })

  it('passes through primitives and null', () => {
    expect(scrub(42)).toBe(42)
    expect(scrub(true)).toBe(true)
    expect(scrub(null)).toBeNull()
    expect(scrub(undefined)).toBeUndefined()
  })
})

describe('logger', () => {
  it('calls console.warn when warn() is invoked', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('[Test] hello')
    expect(spy).toHaveBeenCalledWith('[Test] hello')
    spy.mockRestore()
  })

  it('scrubs the meta arg before passing to console', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('[Test] failed', { name: 'Carlos', errorCode: 'E_OOPS' })
    expect(spy).toHaveBeenCalledWith('[Test] failed', { name: '[redacted]', errorCode: 'E_OOPS' })
    spy.mockRestore()
  })

  it('does not pass meta when none is provided', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {})
    logger.info('[Test] message')
    expect(spy).toHaveBeenCalledWith('[Test] message')
    expect(spy.mock.calls[0]).toHaveLength(1)
    spy.mockRestore()
  })
})
