import { useId } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Frame } from '../simulation/engine'
import type { Fault } from '../simulation/schema'

type Metric = 'p95' | 'errorRate' | 'retries' | 'throughput'
const labels: Record<Metric, string> = {
  p95: 'P95 response time',
  errorRate: 'Error rate',
  retries: 'Retry pressure',
  throughput: 'Successful throughput',
}
const units: Record<Metric, string> = { p95: 'ms', errorRate: '%', retries: '/s', throughput: '/s' }
const colors: Record<Metric, string> = {
  p95: 'var(--cp-link)',
  errorRate: 'var(--cp-accent)',
  retries: 'var(--cp-success)',
  throughput: 'var(--cp-link)',
}

export function MetricChart({
  frames,
  alternate,
  cursor,
  metric,
  faults = [],
}: {
  frames: Frame[]
  alternate?: Frame[]
  cursor: number
  metric: Metric
  faults?: Fault[]
}) {
  const id = useId()
  const data = frames.map((frame, index) => ({
    time: frame.time,
    value: frame[metric],
    alternative: alternate?.[index]?.[metric],
  }))
  const value = frames[Math.min(Math.floor(cursor), frames.length - 1)]?.[metric] ?? 0
  return (
    <section className="metric-chart" aria-label={labels[metric]}>
      <div className="chart-heading">
        <h3>{labels[metric]}</h3>
        <span>
          <strong>{metric === 'errorRate' ? value.toFixed(1) : value}</strong>
          <small>{units[metric]}</small>
        </span>
      </div>
      <div
        className="chart-plot"
        role="img"
        aria-label={`${labels[metric]} at ${Math.floor(cursor)} seconds: ${value.toFixed(1)} ${units[metric]}. Data is also available in the telemetry table.`}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -23 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors[metric]} stopOpacity={0.2} />
                <stop offset="100%" stopColor={colors[metric]} stopOpacity={0.015} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--cp-border)" vertical={false} strokeDasharray="2 4" />
            <XAxis
              dataKey="time"
              type="number"
              domain={[0, 'dataMax']}
              tick={{ fontSize: 10, fill: 'var(--cp-text-soft)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={22}
              tickFormatter={(value) => `${value}s`}
            />
            <YAxis
              domain={[0, metric === 'errorRate' ? 100 : 'auto']}
              tick={{ fontSize: 10, fill: 'var(--cp-text-soft)' }}
              tickLine={false}
              axisLine={false}
              tickCount={3}
              width={52}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--cp-surface)',
                border: '1px solid var(--cp-border)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--cp-text)',
              }}
              labelFormatter={(label) => `T + ${label}s`}
              formatter={(value, name) => [
                `${Number(value).toFixed(metric === 'errorRate' ? 1 : 0)} ${units[metric]}`,
                name === 'value' ? 'Current' : 'Comparison',
              ]}
            />
            {faults.map((fault, index) => (
              <ReferenceArea
                key={index}
                x1={fault.start}
                x2={fault.start + fault.duration}
                fill="var(--cp-accent)"
                fillOpacity={0.045}
              />
            ))}
            <Area
              type="monotone"
              dataKey="value"
              stroke={colors[metric]}
              strokeWidth={1.8}
              fill={`url(#${id})`}
              isAnimationActive={false}
            />
            {alternate && (
              <Line
                type="monotone"
                dataKey="alternative"
                stroke="var(--cp-text-muted)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
            <ReferenceLine
              x={Math.floor(cursor)}
              stroke="var(--cp-text)"
              strokeDasharray="2 3"
              strokeOpacity={0.55}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export function Telemetry({
  frames,
  cursor,
  faults,
}: {
  frames: Frame[]
  cursor: number
  faults: Fault[]
}) {
  return (
    <section className="telemetry" aria-label="Experiment telemetry">
      <div className="section-heading">
        <h2>Experiment telemetry</h2>
        <span className="muted">1-second samples</span>
      </div>
      <div className="chart-grid">
        <MetricChart frames={frames} cursor={cursor} metric="p95" faults={faults} />
        <MetricChart frames={frames} cursor={cursor} metric="errorRate" faults={faults} />
        <MetricChart frames={frames} cursor={cursor} metric="retries" faults={faults} />
      </div>
      <details className="telemetry-table">
        <summary>Telemetry table</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="One-second telemetry">
          <table>
            <caption className="sr-only">One-second simulation samples</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Arrivals</th>
                <th scope="col">Successes</th>
                <th scope="col">Errors</th>
                <th scope="col">P95 (ms)</th>
                <th scope="col">Retries</th>
                <th scope="col">In flight</th>
              </tr>
            </thead>
            <tbody>
              {frames.map((frame) => (
                <tr key={frame.time}>
                  <th scope="row">{frame.time}s</th>
                  <td>{frame.arrivals}</td>
                  <td>{frame.throughput}</td>
                  <td>{frame.errors}</td>
                  <td>{frame.p95}</td>
                  <td>{frame.retries}</td>
                  <td>{frame.inFlight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
