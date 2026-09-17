import { describe, expect, it } from 'vitest'
import { defaultScenario, scenarioSchema } from './schema'
import {
  comparisonScenario,
  decodeScenario,
  encodeScenario,
  initialScenario,
  parseScenario,
} from './sharing'

describe('public experiment links', () => {
  it('round-trips the complete validated configuration', () => {
    const scenario = { ...defaultScenario, name: 'Experiment: queue & latency', breaker: true }
    expect(decodeScenario(encodeScenario(scenario))).toEqual(scenario)
  })

  it('round-trips Unicode names without compressed payload expansion', () => {
    const scenario = {
      ...defaultScenario,
      name: `Experiment ${String.fromCodePoint(0x03b1, 0x1f9ea)}`,
    }
    expect(decodeScenario(encodeScenario(scenario))).toEqual(scenario)
    expect(() => decodeScenario('#experiment=_w')).toThrow('could not be decoded')
  })

  it('rejects malformed, oversized, and untrusted configurations', () => {
    expect(() => decodeScenario('#experiment=garbage')).toThrow()
    expect(() => decodeScenario(`#experiment=${'a'.repeat(12001)}`)).toThrow()
    expect(() => parseScenario('[')).toThrow('valid JSON')
    expect(() => parseScenario(' '.repeat(32001))).toThrow('32 KB')
    expect(() => parseScenario(JSON.stringify({ ...defaultScenario, traffic: -1 }))).toThrow()
  })

  it('prefers a shared experiment over local storage', () => {
    const shared = { ...defaultScenario, seed: 123 }
    expect(
      initialScenario(encodeScenario(shared), JSON.stringify(defaultScenario)).scenario.seed,
    ).toBe(123)
  })

  it('recovers from corrupt storage with an explicit notice', () => {
    const restored = initialScenario('', '{broken')
    expect(restored.scenario).toEqual(defaultScenario)
    expect(restored.notice).toContain('default experiment')
  })

  it('changes only the comparison protections, preserving topology and load', () => {
    const compared = comparisonScenario(defaultScenario)
    expect(compared.breaker).toBe(true)
    expect(compared.jitter).toBe(true)
    expect(compared.nodes).toEqual(defaultScenario.nodes)
    expect(compared.traffic).toBe(defaultScenario.traffic)
    expect(scenarioSchema.safeParse(compared).success).toBe(true)
  })
})
