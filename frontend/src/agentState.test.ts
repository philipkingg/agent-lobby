import { describe, it, expect } from 'vitest'
import { agentVisual, projectColor } from './agentState'

describe('agentVisual', () => {
  it('maps running to working with a bob animation and no badge', () => {
    expect(agentVisual('running')).toEqual({ state: 'working', color: 0x4caf50, badge: null, animation: 'bob' })
  })

  it('maps blocked to working with a question badge and pulse animation', () => {
    expect(agentVisual('blocked')).toEqual({
      state: 'working',
      color: 0x4caf50,
      badge: 'question',
      animation: 'pulse',
    })
  })

  it('maps done to the done state with a slack-off animation', () => {
    expect(agentVisual('done')).toEqual({ state: 'done', color: 0x42a5f5, badge: null, animation: 'slack' })
  })

  it('maps error and failed to the error state with an error badge and pulse animation', () => {
    expect(agentVisual('error')).toEqual({ state: 'error', color: 0xe53935, badge: 'error', animation: 'pulse' })
    expect(agentVisual('failed')).toEqual({ state: 'error', color: 0xe53935, badge: 'error', animation: 'pulse' })
  })

  it('maps queued and stopped to the idle state', () => {
    expect(agentVisual('queued')).toEqual({ state: 'idle', color: 0x90a4ae, badge: null, animation: 'none' })
    expect(agentVisual('stopped')).toEqual({ state: 'done', color: 0x90a4ae, badge: null, animation: 'none' })
  })

  it('falls back to idle for unknown statuses', () => {
    expect(agentVisual('something-unknown').state).toBe('idle')
  })
})

describe('projectColor', () => {
  it('is deterministic for the same project id', () => {
    expect(projectColor('proj-1')).toBe(projectColor('proj-1'))
  })

  it('returns different colors for different project ids', () => {
    expect(projectColor('proj-1')).not.toBe(projectColor('proj-2'))
  })
})
