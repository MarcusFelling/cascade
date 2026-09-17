import { simulate, type SimulationResult } from './engine'
import { comparisonScenario } from './sharing'
import type { Scenario } from './schema'

export type WorkerResponse =
  | { result: SimulationResult; comparison: SimulationResult }
  | { error: string }

self.onmessage = (event: MessageEvent<Scenario>) => {
  try {
    const result = simulate(event.data)
    const comparison = simulate(comparisonScenario(event.data))
    self.postMessage({ result, comparison } satisfies WorkerResponse)
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'The experiment could not be simulated.',
    } satisfies WorkerResponse)
  }
}
