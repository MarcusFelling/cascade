import { defaultScenario, scenarioSchema, type Scenario } from './schema'
import type { SimulationResult } from './engine'

export const STORAGE_KEY = 'cascade.experiment.v1'
export const MODEL_VERSION = '1.0.0'

export function parseScenario(text: string): Scenario {
  if (text.length > 32_000) throw new Error('Experiment files must be smaller than 32 KB.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('This file does not contain valid JSON.')
  }
  const parsed = scenarioSchema.safeParse(value)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid experiment.')
  return parsed.data
}

export function encodeScenario(scenario: Scenario): string {
  const bytes = new TextEncoder().encode(JSON.stringify(scenarioSchema.parse(scenario)))
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  if (encoded.length > 12_000)
    throw new Error('This experiment is too large to share as a link. Export the JSON instead.')
  return `#experiment=${encoded}`
}

export function decodeScenario(hash: string): Scenario {
  const encoded = new URLSearchParams(hash.replace(/^#/, '')).get('experiment')
  if (!encoded || encoded.length > 12_000 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error('This experiment link is invalid or too large.')
  let text: string
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('This experiment link could not be decoded.')
  }
  return parseScenario(text)
}

export function initialScenario(
  hash: string,
  saved: string | null,
): { scenario: Scenario; notice: string } {
  try {
    if (new URLSearchParams(hash.replace(/^#/, '')).has('experiment'))
      return { scenario: decodeScenario(hash), notice: 'Shared experiment loaded.' }
    if (saved) return { scenario: parseScenario(saved), notice: 'Saved experiment restored.' }
  } catch (error) {
    return {
      scenario: structuredClone(defaultScenario),
      notice:
        error instanceof Error
          ? `${error.message} Loaded the default experiment.`
          : 'Could not load experiment. Loaded the default.',
    }
  }
  return { scenario: structuredClone(defaultScenario), notice: '' }
}

export function comparisonScenario(scenario: Scenario): Scenario {
  return {
    ...scenario,
    breaker: !scenario.breaker,
    jitter: scenario.breaker ? scenario.jitter : true,
  }
}

export function experimentBrief(
  scenario: Scenario,
  baseline: SimulationResult,
  alternative: SimulationResult,
): string {
  const current = baseline.summary
  const compared = alternative.summary
  const label = scenario.breaker ? 'Circuit breaker disabled' : 'Circuit breaker + jitter'
  const recovery = (value: number | null) => (value === null ? 'Not observed' : `${value}s`)
  return [
    `# Cascade: ${scenario.name}`,
    '',
    `Model ${MODEL_VERSION}. Seed ${scenario.seed}. Duration ${scenario.duration}s. Offered load ${scenario.traffic} requests/s before any traffic fault.`,
    '',
    `| Metric | Current experiment | ${label} |`,
    '| --- | ---: | ---: |',
    `| External requests | ${current.arrivals} | ${compared.arrivals} |`,
    `| Successful requests | ${current.successful} | ${compared.successful} |`,
    `| Failed requests | ${current.failed} | ${compared.failed} |`,
    `| Pending at end | ${current.pending} | ${compared.pending} |`,
    `| Success rate (completed requests) | ${current.availability.toFixed(2)}% | ${compared.availability.toFixed(2)}% |`,
    `| P95 terminal response time | ${current.p95}ms | ${compared.p95}ms |`,
    `| Leaf-call retries | ${current.retries} | ${compared.retries} |`,
    `| Peak sampled service queue | ${current.peakQueue} | ${compared.peakQueue} |`,
    `| Recovery after final fault | ${recovery(current.recovery)} | ${recovery(compared.recovery)} |`,
    '',
    '## Model boundaries',
    '',
    'This is a synthetic discrete-event simulation, not a prediction of production performance. P95 includes failed and fast-rejected requests. Lower latency can therefore accompany lower availability. Recovery requires three consecutive one-second samples below 1% errors, with successful traffic and empty queues. Retries and circuit breakers apply to leaf dependencies. In-flight server work continues after caller timeouts. Each connection is a required dependency; dependencies run in parallel. Cache hits skip downstream dependencies.',
    '',
    '## Reproducible configuration',
    '',
    '```json',
    JSON.stringify(scenario, null, 2),
    '```',
    '',
  ].join('\n')
}
