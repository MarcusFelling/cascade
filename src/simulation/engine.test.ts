import { describe, expect, it } from 'vitest'
import { simulate } from './engine'
import { defaultScenario, presets, scenarioSchema } from './schema'

describe('discrete-event simulation', () => {
  it('reproduces every frame and event with the same seed', () => {
    const scenario = { ...defaultScenario, duration: 30, faults: [], traffic: 30 }
    expect(simulate(scenario)).toEqual(simulate(scenario))
  })

  it('accounts for every external request, including work still in flight', () => {
    const result = simulate(defaultScenario)
    expect(result.summary.arrivals).toBe(
      result.summary.successful + result.summary.failed + result.summary.pending,
    )
    expect(result.frames).toHaveLength(defaultScenario.duration + 1)
    expect(result.frames.reduce((total, frame) => total + frame.arrivals, 0)).toBe(
      result.summary.arrivals,
    )
    expect(result.frames.every((frame) => frame.inFlight >= 0)).toBe(true)
  })

  it('serves the healthy workload without retries or errors', () => {
    const result = simulate({ ...defaultScenario, faults: [] })
    expect(result.summary.availability).toBe(100)
    expect(result.summary.retries).toBe(0)
    expect(result.summary.p95).toBeLessThan(150)
  })

  it('produces queue pressure and retries when the database slows down', () => {
    const result = simulate(defaultScenario)
    expect(result.summary.failed).toBeGreaterThan(500)
    expect(result.summary.retries).toBeGreaterThan(100)
    expect(result.summary.peakQueue).toBeGreaterThan(10)
    expect(result.frames.at(-1)!.errorRate).toBe(0)
    expect(result.summary.recovery).not.toBeNull()
  })

  it('reduces retries with a breaker while preserving the external workload', () => {
    const baseline = simulate(defaultScenario)
    const protectedRun = simulate({ ...defaultScenario, breaker: true, jitter: true })
    expect(protectedRun.summary.arrivals).toBe(baseline.summary.arrivals)
    expect(protectedRun.frames.map((frame) => frame.arrivals)).toEqual(
      baseline.frames.map((frame) => frame.arrivals),
    )
    expect(protectedRun.summary.retries).toBeLessThan(baseline.summary.retries)
    expect(
      protectedRun.incidents.some((incident) => incident.message.includes('Circuit opened')),
    ).toBe(true)
    expect(
      protectedRun.incidents.some((incident) => incident.message.includes('Circuit closed')),
    ).toBe(true)
  })

  it('runs every bundled scenario with bounded queues and utilization', () => {
    for (const preset of presets) {
      const result = simulate(preset.scenario)
      expect(result.summary.arrivals).toBeGreaterThan(0)
      for (const frame of result.frames) {
        for (const node of Object.values(frame.nodes)) {
          expect(node.active).toBeGreaterThanOrEqual(0)
          expect(node.queued).toBeLessThanOrEqual(80)
          expect(node.load).toBeLessThanOrEqual(100)
        }
      }
    }
  })
})

describe('architecture validation', () => {
  it('rejects cycles, including disconnected cycles', () => {
    expect(
      scenarioSchema.safeParse({
        ...defaultScenario,
        edges: [...defaultScenario.edges, { source: 'database', target: 'gateway' }],
      }).success,
    ).toBe(false)
  })

  it('rejects unbounded workloads and faults outside the experiment', () => {
    expect(scenarioSchema.safeParse({ ...defaultScenario, traffic: 999999 }).success).toBe(false)
    expect(scenarioSchema.safeParse({ ...defaultScenario, duration: 30 }).success).toBe(false)
  })

  it('rejects dangling connections and duplicate service IDs', () => {
    expect(
      scenarioSchema.safeParse({
        ...defaultScenario,
        edges: [{ source: 'gateway', target: 'unknown' }],
      }).success,
    ).toBe(false)
    expect(
      scenarioSchema.safeParse({
        ...defaultScenario,
        nodes: [...defaultScenario.nodes, defaultScenario.nodes[0]],
      }).success,
    ).toBe(false)
  })
})
