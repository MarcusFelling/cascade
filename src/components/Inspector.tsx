import { Minus, Plus, ShieldCheck, SlidersHorizontal, Trash2, Unplug, X, Zap } from 'lucide-react'
import { useState } from 'react'
import type { Fault, Scenario, Service } from '../simulation/schema'

function RangeField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  unit: string
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="range-field">
      <span>
        <span>{label}</span>
        <output>
          {value.toLocaleString()}
          <small>{unit}</small>
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="range-extents">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </span>
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  )
}

type Props = {
  scenario: Scenario
  selected: string
  mode: 'controls' | 'service'
  setMode: (mode: 'controls' | 'service') => void
  update: (next: Scenario) => void
  onInject: (target: string, kind: Fault['kind']) => void
  onDelete: (id: string) => void
  onConnect: (source: string, target: string) => void
}

export function Inspector({
  scenario,
  selected,
  mode,
  setMode,
  update,
  onInject,
  onDelete,
  onConnect,
}: Props) {
  const service = scenario.nodes.find((node) => node.id === selected) ?? scenario.nodes[0]
  const [target, setTarget] = useState('database')
  const [kind, setKind] = useState<Fault['kind']>('latency')
  const [connection, setConnection] = useState('')
  const faultTarget = scenario.nodes.some((node) => node.id === target) ? target : service.id
  const patchService = (patch: Partial<Service>) =>
    update({
      ...scenario,
      nodes: scenario.nodes.map((node) => (node.id === service.id ? { ...node, ...patch } : node)),
    })
  const dependencies = scenario.edges.filter((edge) => edge.source === service.id)
  return (
    <aside className="inspector" id="inspector" aria-label="Experiment settings">
      <div className="inspector-tabs" role="tablist" aria-label="Inspector">
        <button
          id="controls-tab"
          role="tab"
          aria-selected={mode === 'controls'}
          aria-controls="controls-panel"
          onClick={() => setMode('controls')}
        >
          <SlidersHorizontal size={15} />
          Controls
        </button>
        <button
          id="service-tab"
          role="tab"
          aria-selected={mode === 'service'}
          aria-controls="service-panel"
          onClick={() => setMode('service')}
        >
          <Unplug size={15} />
          Service
        </button>
      </div>
      {mode === 'controls' ? (
        <div
          id="controls-panel"
          role="tabpanel"
          aria-labelledby="controls-tab"
          className="inspector-content"
        >
          <div className="inspector-section">
            <div className="inspector-heading">
              <h2>Workload</h2>
              <span className="tag">Poisson</span>
            </div>
            <RangeField
              label="Arrival rate"
              value={scenario.traffic}
              unit="/s"
              min={10}
              max={300}
              step={10}
              onChange={(traffic) => update({ ...scenario, traffic })}
            />
            <RangeField
              label="Request timeout"
              value={scenario.timeout}
              unit="ms"
              min={100}
              max={3000}
              step={100}
              onChange={(timeout) => update({ ...scenario, timeout })}
            />
          </div>
          <div className="inspector-section">
            <h2>Resilience</h2>
            <div className="field-label">
              Max retries <span className="muted">Leaf dependencies</span>
            </div>
            <div className="segmented retry-options" role="group" aria-label="Maximum retries">
              {[0, 1, 2, 3].map((retries) => (
                <button
                  key={retries}
                  aria-label={`${retries} retries`}
                  aria-pressed={scenario.retries === retries}
                  onClick={() => update({ ...scenario, retries })}
                >
                  {retries}
                </button>
              ))}
            </div>
            <Toggle
              label="Circuit breaker"
              checked={scenario.breaker}
              onChange={(breaker) => update({ ...scenario, breaker })}
            />
            <Toggle
              label="Jittered backoff"
              checked={scenario.jitter}
              onChange={(jitter) => update({ ...scenario, jitter })}
            />
            {scenario.breaker && (
              <div className="protection-state">
                <ShieldCheck size={14} />
                <span>5 failures / 4s cooldown / 1 probe</span>
              </div>
            )}
          </div>
          <div className="inspector-section fault-section">
            <div className="inspector-heading">
              <h2>Fault injection</h2>
              <Zap size={15} />
            </div>
            <label className="select-field">
              Target service
              <select value={faultTarget} onChange={(event) => setTarget(event.target.value)}>
                {scenario.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-field">
              Fault type
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as Fault['kind'])}
              >
                <option value="latency">Latency spike (24x)</option>
                <option value="outage">Service outage</option>
                <option value="traffic">Traffic surge (3x)</option>
              </select>
            </label>
            <button
              className="button primary inject-button"
              onClick={() => onInject(faultTarget, kind)}
            >
              <Zap size={16} />
              Inject failure
            </button>
            <button
              className="subtle-button clear-faults"
              disabled={!scenario.faults.length}
              onClick={() => update({ ...scenario, faults: [] })}
            >
              <X size={14} />
              Clear faults
            </button>
          </div>
        </div>
      ) : (
        <div
          id="service-panel"
          role="tabpanel"
          aria-labelledby="service-tab"
          className="inspector-content"
        >
          <div className="inspector-section">
            <div className="inspector-heading">
              <h2>{service.name}</h2>
              <span className="tag">{service.kind}</span>
            </div>
            <label className="select-field">
              Service name
              <input
                key={service.id + service.name}
                defaultValue={service.name}
                maxLength={24}
                onBlur={(event) => {
                  if (event.target.value.trim()) patchService({ name: event.target.value.trim() })
                  else event.target.value = service.name
                }}
              />
            </label>
            <div className="field-label">Replicas</div>
            <div className="stepper">
              <button
                className="icon-button"
                aria-label="Remove replica"
                disabled={service.replicas <= 1}
                onClick={() => patchService({ replicas: service.replicas - 1 })}
              >
                <Minus size={16} />
              </button>
              <output aria-label="Replica count">{service.replicas}</output>
              <button
                className="icon-button"
                aria-label="Add replica"
                disabled={service.replicas >= 8}
                onClick={() => patchService({ replicas: service.replicas + 1 })}
              >
                <Plus size={16} />
              </button>
            </div>
            <RangeField
              label="Concurrency per replica"
              value={service.concurrency}
              unit=""
              min={1}
              max={64}
              onChange={(concurrency) => patchService({ concurrency })}
            />
            <RangeField
              label="Processing latency"
              value={service.latency}
              unit="ms"
              min={2}
              max={200}
              onChange={(latency) => patchService({ latency })}
            />
            {service.kind === 'cache' && (
              <RangeField
                label="Cache hit rate"
                value={Math.round(service.hitRate * 100)}
                unit="%"
                min={0}
                max={95}
                step={5}
                onChange={(hitRate) => patchService({ hitRate: hitRate / 100 })}
              />
            )}
          </div>
          <div className="inspector-section">
            <h2>Dependencies</h2>
            <div className="dependency-list">
              {dependencies.length ? (
                dependencies.map((edge) => (
                  <div key={edge.target}>
                    <span>{scenario.nodes.find((node) => node.id === edge.target)?.name}</span>
                    <button
                      className="icon-button"
                      aria-label={`Remove dependency on ${edge.target}`}
                      onClick={() =>
                        update({
                          ...scenario,
                          edges: scenario.edges.filter((candidate) => candidate !== edge),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">Leaf service</p>
              )}
            </div>
            <div className="connection-field">
              <select
                aria-label="New dependency"
                value={connection}
                onChange={(event) => setConnection(event.target.value)}
              >
                <option value="">Select service</option>
                {scenario.nodes
                  .filter(
                    (node) =>
                      node.id !== service.id &&
                      !dependencies.some((edge) => edge.target === node.id),
                  )
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
              </select>
              <button
                className="icon-button"
                aria-label="Connect dependency"
                disabled={!connection}
                onClick={() => {
                  onConnect(service.id, connection)
                  setConnection('')
                }}
              >
                <Plus size={17} />
              </button>
            </div>
          </div>
          <div className="inspector-section">
            <button
              className="button danger-button"
              disabled={service.kind === 'gateway' || scenario.nodes.length <= 2}
              onClick={() => onDelete(service.id)}
            >
              <Trash2 size={15} />
              Remove service
            </button>
          </div>
        </div>
      )}
      <div className="inspector-footer">
        <span className="status-dot healthy" />
        Deterministic / seed {scenario.seed}
      </div>
    </aside>
  )
}
