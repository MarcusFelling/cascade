import { ArrowDownRight, ArrowUpRight, Download, ShieldCheck } from 'lucide-react'
import type { Scenario } from '../simulation/schema'
import type { SimulationResult } from '../simulation/engine'
import { comparisonScenario } from '../simulation/sharing'
import { MetricChart } from './Telemetry'

export function Comparison({
  scenario,
  result,
  comparison,
  onApply,
  onExport,
}: {
  scenario: Scenario
  result: SimulationResult
  comparison: SimulationResult
  onApply: (scenario: Scenario) => void
  onExport: () => void
}) {
  const baseline = result.summary
  const alternative = comparison.summary
  const retryDifference = baseline.retries - alternative.retries
  const successDifference = alternative.successful - baseline.successful
  const availabilityDifference = alternative.availability - baseline.availability
  const alternativeName = scenario.breaker ? 'Circuit breaker disabled' : 'Circuit breaker + jitter'
  const rows = [
    {
      name: 'Success rate',
      current: `${baseline.availability.toFixed(2)}%`,
      alternative: `${alternative.availability.toFixed(2)}%`,
    },
    {
      name: 'Successful requests',
      current: baseline.successful.toLocaleString(),
      alternative: alternative.successful.toLocaleString(),
    },
    {
      name: 'Failed requests',
      current: baseline.failed.toLocaleString(),
      alternative: alternative.failed.toLocaleString(),
    },
    {
      name: 'P95 response time',
      current: `${baseline.p95.toLocaleString()} ms`,
      alternative: `${alternative.p95.toLocaleString()} ms`,
    },
    {
      name: 'Leaf-call retries',
      current: baseline.retries.toLocaleString(),
      alternative: alternative.retries.toLocaleString(),
    },
    {
      name: 'Peak sampled queue',
      current: baseline.peakQueue.toLocaleString(),
      alternative: alternative.peakQueue.toLocaleString(),
    },
    {
      name: 'Recovery after fault',
      current: baseline.recovery === null ? 'Not observed' : `${baseline.recovery}s`,
      alternative: alternative.recovery === null ? 'Not observed' : `${alternative.recovery}s`,
    },
    {
      name: 'Pending at end',
      current: baseline.pending.toLocaleString(),
      alternative: alternative.pending.toLocaleString(),
    },
  ]
  return (
    <section className="comparison-view">
      <div className="comparison-intro">
        <div>
          <span className="eyebrow">Controlled comparison</span>
          <h2>The cost of a retry.</h2>
          <p>
            {baseline.arrivals.toLocaleString()} external requests. Same arrival times. Same seed.
          </p>
        </div>
        <div className="comparison-actions">
          <button className="button" onClick={onExport}>
            <Download size={16} />
            Export brief
          </button>
          <button className="button primary" onClick={() => onApply(comparisonScenario(scenario))}>
            <ShieldCheck size={16} />
            Apply comparison
          </button>
        </div>
      </div>
      <div className="comparison-deltas">
        <div>
          <span className="eyebrow">Retry reduction</span>
          <strong className={retryDifference >= 0 ? 'positive' : 'negative'}>
            {retryDifference >= 0 ? <ArrowDownRight size={25} /> : <ArrowUpRight size={25} />}
            {Math.abs(retryDifference).toLocaleString()}
          </strong>
          <span>{retryDifference >= 0 ? 'fewer' : 'additional'} internal retry attempts</span>
        </div>
        <div>
          <span className="eyebrow">Success rate change</span>
          <strong className={availabilityDifference >= 0 ? 'positive' : 'negative'}>
            {availabilityDifference >= 0 ? '+' : ''}
            {availabilityDifference.toFixed(2)}
            <small>pp</small>
          </strong>
          <span>among completed external requests</span>
        </div>
        <div>
          <span className="eyebrow">Successful requests</span>
          <strong>
            {successDifference >= 0 ? '+' : ''}
            {successDifference.toLocaleString()}
          </strong>
          <span>with the comparison controls</span>
        </div>
      </div>
      <div className="comparison-detail">
        <div className="comparison-results">
          <div className="section-heading">
            <h3>Full experiment results</h3>
            <span className="tag">{scenario.duration}s</span>
          </div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Comparison metrics">
            <table>
              <caption className="sr-only">
                Current settings compared with {alternativeName}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Current controls</th>
                  <th scope="col">{alternativeName}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <th scope="row">{row.name}</th>
                    <td>{row.current}</td>
                    <td>{row.alternative}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="model-caveat">
            P95 includes fast failures. Lower latency can accompany lower availability. Recovery
            requires three consecutive healthy samples after the final fault.
          </p>
        </div>
        <div className="comparison-charts">
          <div className="chart-key">
            <span>
              <i />
              Current controls
            </span>
            <span>
              <i className="alternate-line" />
              Comparison
            </span>
          </div>
          <MetricChart
            frames={result.frames}
            alternate={comparison.frames}
            cursor={scenario.duration}
            metric="errorRate"
            faults={scenario.faults}
          />
          <MetricChart
            frames={result.frames}
            alternate={comparison.frames}
            cursor={scenario.duration}
            metric="retries"
            faults={scenario.faults}
          />
        </div>
      </div>
    </section>
  )
}
