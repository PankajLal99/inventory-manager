import { describe, it, expect } from 'vitest'
import { displayName, initials } from '../src/lib/salaryBookPwa'

describe('Salary Book profile helpers', () => {
  it('prefers full name over username', () => {
    expect(displayName({ first_name: 'Ramesh', last_name: 'Kumar', username: 'owner' })).toBe('Ramesh Kumar')
  })

  it('falls back to username', () => {
    expect(displayName({ username: 'owner' })).toBe('owner')
    expect(displayName(null)).toBe('User')
  })

  it('builds initials from name or username', () => {
    expect(initials({ first_name: 'Ramesh', last_name: 'Kumar' })).toBe('RK')
    expect(initials({ username: 'owner' })).toBe('OW')
    expect(initials(null)).toBe('U')
  })
})
