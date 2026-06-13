import { describe, it, expect } from 'vitest'
import { agentVisual } from './agentState'

describe('agentVisual', () => {
  it('maps running to working with no badge', () => {
    expect(agentVisual('running')).toEqual({ state: 'working', color: 0x4caf50, badge: null })
  })

  it('maps blocked to working with a question badge', () => {
    expect(agentVisual('blocked')).toEqual({ state: 'working', color: 0x4caf50, badge: 'question' })
  })

  it('maps done to the done state', () => {
    expect(agentVisual('done').state).toBe('done')
  })

  it('maps error and failed to the error state with an error badge', () => {
    expect(agentVisual('error')).toEqual({ state: 'error', color: 0xe53935, badge: 'error' })
    expect(agentVisual('failed')).toEqual({ state: 'error', color: 0xe53935, badge: 'error' })
  })

  it('falls back to idle for unknown statuses', () => {
    expect(agentVisual('queued').state).toBe('idle')
    expect(agentVisual('something-unknown').state).toBe('idle')
  })
})
