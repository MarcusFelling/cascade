import { startTransition, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  CodeXml,
  FileJson,
  FlaskConical,
  GitCompareArrows,
  LoaderCircle,
  Moon,
  Network,
  Pause,
  Play,
  RotateCcw,
  Save,
  Share2,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sun,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import { Comparison } from './components/Comparison'
import { Inspector } from './components/Inspector'
import { Telemetry } from './components/Telemetry'
import { Topology } from './components/Topology'
import { presets, scenarioSchema, type Fault, type Scenario } from './simulation/schema'
import {
  STORAGE_KEY,
  encodeScenario,
  experimentBrief,
  initialScenario,
  parseScenario,
} from './simulation/sharing'
import { useSimulation } from './simulation/useSimulation'

const formatTime = (time: number) =>
  `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`
const count = (value: number) => value.toLocaleString('en-US')

function loadInitial() {
  try {
    return initialScenario(window.location.hash, window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return initialScenario(window.location.hash, null)
  }
}

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const [initial] = useState(loadInitial)
  const [scenario, setScenario] = useState<Scenario>(initial.scenario)
  const [notice, setNotice] = useState(initial.notice)
  const [view, setView] = useState<'lab' | 'compare'>('lab')
  const [selected, setSelected] = useState('database')
  const [inspectorMode, setInspectorMode] = useState<'controls' | 'service'>('controls')
  const [playback, setPlayback] = useState(() => ({
    time: 0,
    rate: 2,
    running: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }))
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light')
  const [shareLink, setShareLink] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const shareDialog = useRef<HTMLDialogElement>(null)
  const { result, comparison, pending, error } = useSimulation(scenario)
  const frame = result?.frames[Math.min(Math.floor(playback.time), scenario.duration)]
  const preset = presets.find((item) => item.name === scenario.name)
  const activeFault = scenario.faults.find(
    (fault) => playback.time >= fault.start && playback.time < fault.start + fault.duration,
  )
  const queued = Object.values(frame?.nodes ?? {}).reduce((total, node) => total + node.queued, 0)
  const visibleIncidents =
    result?.incidents
      .filter((incident) => incident.time <= playback.time)
      .slice(-5)
      .reverse() ?? []

  useEffect(() => {
    if (!playback.running || pending || error || view !== 'lab') return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const elapsed = (now - previous) / 1000
      previous = now
      setPlayback((current) => {
        const time = Math.min(scenario.duration, current.time + elapsed * current.rate)
        return { ...current, time, running: time < scenario.duration }
      })
    }, 100)
    return () => window.clearInterval(timer)
  }, [playback.running, pending, error, view, scenario.duration])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 7000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, button, [contenteditable], [role="button"], dialog',
        )
      )
        return
      if (event.code === 'Space') {
        event.preventDefault()
        setPlayback((current) => ({
          ...current,
          time: current.time >= scenario.duration ? 0 : current.time,
          running: !current.running,
        }))
      }
      if (event.key.toLowerCase() === 'r')
        setPlayback((current) => ({ ...current, time: 0, running: false }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scenario.duration])

  useEffect(() => {
    const onHash = () => {
      if (!new URLSearchParams(window.location.hash.slice(1)).has('experiment')) return
      const loaded = initialScenario(window.location.hash, null)
      setScenario(loaded.scenario)
      setNotice(loaded.notice)
      setPlayback((current) => ({ ...current, time: 0, running: false }))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const update = (next: Scenario) => {
    const parsed = scenarioSchema.safeParse(next)
    if (!parsed.success) {
      setNotice(parsed.error.issues[0].message)
      return false
    }
    startTransition(() => setScenario(parsed.data))
    return true
  }
  const reset = (next: Scenario) => {
    if (!update(structuredClone(next))) return
    setSelected(next.nodes.find((node) => node.kind === 'database')?.id ?? next.nodes[0].id)
    setPlayback((current) => ({ ...current, time: 0, running: false }))
    setView('lab')
  }
  const selectService = (id: string) => {
    setSelected(id)
    setInspectorMode('service')
  }
  const openControls = () => {
    setInspectorMode('controls')
    if (window.innerWidth < 1180)
      document
        .getElementById('inspector')
        ?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
          block: 'start',
        })
  }
  const connect = (source: string, target: string) =>
    update({ ...scenario, edges: [...scenario.edges, { source, target }] })
  const inject = (target: string, kind: Fault['kind']) => {
    const replayEnded = playback.time >= scenario.duration - 1
    const start = replayEnded ? 1 : Math.floor(playback.time) + 1
    const fault = {
      target:
        kind === 'traffic' ? scenario.nodes.find((node) => node.kind === 'gateway')!.id : target,
      kind,
      start,
      duration: Math.min(25, scenario.duration - start),
      multiplier: kind === 'traffic' ? 3 : 24,
    }
    if (update({ ...scenario, faults: [fault] })) {
      setPlayback((current) => ({
        ...current,
        time: replayEnded ? 0 : current.time,
        running: true,
      }))
      setNotice(`Fault scheduled at ${formatTime(start)}.`)
    }
  }
  const addService = () => {
    let suffix = scenario.nodes.length + 1
    while (scenario.nodes.some((node) => node.id === `service-${suffix}`)) suffix++
    const parent = scenario.nodes.find((node) => node.id === selected) ?? scenario.nodes[0]
    const service = {
      id: `service-${suffix}`,
      name: `Service ${suffix}`,
      kind: 'service' as const,
      replicas: 1,
      concurrency: 16,
      latency: 10,
      hitRate: 0,
      position: { x: Math.min(3800, parent.position.x + 240), y: parent.position.y + 50 },
    }
    if (
      update({
        ...scenario,
        nodes: [...scenario.nodes, service],
        edges: [...scenario.edges, { source: parent.id, target: service.id }],
      })
    )
      selectService(service.id)
  }
  const deleteService = (id: string) => {
    const incoming = scenario.edges.filter((edge) => edge.target === id)
    const outgoing = scenario.edges.filter((edge) => edge.source === id)
    const remaining = scenario.edges.filter((edge) => edge.source !== id && edge.target !== id)
    for (const parent of incoming)
      for (const child of outgoing)
        if (
          !remaining.some((edge) => edge.source === parent.source && edge.target === child.target)
        )
          remaining.push({ source: parent.source, target: child.target })
    const next = {
      ...scenario,
      nodes: scenario.nodes.filter((node) => node.id !== id),
      edges: remaining,
      faults: scenario.faults.filter((fault) => fault.target !== id),
    }
    if (update(next)) setSelected(next.nodes[0].id)
  }
  const save = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario))
      setNotice('Experiment saved in this browser.')
    } catch {
      setNotice('Browser storage is unavailable. Export the experiment as JSON instead.')
    }
  }
  const share = async () => {
    try {
      const url = `${window.location.origin}${window.location.pathname}${encodeScenario(scenario)}`
      try {
        await navigator.clipboard.writeText(url)
        setNotice('Reproducible experiment link copied.')
      } catch {
        setShareLink(url)
        shareDialog.current?.showModal()
      }
    } catch (shareError) {
      setNotice(
        shareError instanceof Error ? shareError.message : 'Could not create the experiment link.',
      )
    }
  }
  const exportBrief = () => {
    if (result && comparison && !pending)
      download(
        experimentBrief(scenario, result, comparison),
        'cascade-incident-brief.md',
        'text/markdown;charset=utf-8',
      )
  }
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    setTheme(next)
  }
  const seek = (time: number) =>
    setPlayback((current) => ({
      ...current,
      time: Math.max(0, Math.min(scenario.duration, time)),
      running: false,
    }))

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to experiment
      </a>
      <header className="app-header">
        <a className="brand" href={window.location.pathname} aria-label="Cascade home">
          <Workflow size={31} strokeWidth={1.6} />
          <span>
            Cascade<span className="brand-period">.</span>
          </span>
        </a>
        <nav className="view-nav" aria-label="Application views">
          <button aria-pressed={view === 'lab'} onClick={() => setView('lab')}>
            <Network size={16} />
            Experiment
          </button>
          <button
            aria-pressed={view === 'compare'}
            disabled={!result || !comparison || pending}
            onClick={() => {
              setView('compare')
              setPlayback((current) => ({ ...current, running: false }))
            }}
          >
            <GitCompareArrows size={16} />
            Compare
          </button>
        </nav>
        <div className="header-end">
          <span className="simulation-badge">
            <span />
            Simulation
          </span>
          <a
            className="icon-button"
            href="https://github.com/MarcusFelling/cascade"
            target="_blank"
            rel="noreferrer"
            aria-label="Source code"
            title="Source code"
          >
            <CodeXml size={19} />
          </a>
          <button
            className="icon-button"
            onClick={toggleTheme}
            aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}
            title={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </header>
      <main id="main-content">
        <div className="experiment-heading">
          <div className="experiment-title">
            <div className="breadcrumb">
              <span>Distributed systems lab</span>
              <ChevronRight size={12} />
              <span>Experiment {preset?.number ?? 'custom'}</span>
            </div>
            <h1>{scenario.name}</h1>
            <div className="experiment-meta">
              <span>
                <Clock3 size={12} />
                {scenario.duration}-second experiment
              </span>
              <span>
                <Braces size={12} />
                seed {scenario.seed}
              </span>
              <span>Synthetic workload</span>
            </div>
          </div>
          <div className="experiment-actions">
            <label className="scenario-picker">
              <FlaskConical size={16} />
              <select
                aria-label="Experiment"
                value={preset?.id ?? 'custom'}
                onChange={(event) => {
                  const next = presets.find((item) => item.id === event.target.value)
                  if (next) reset(next.scenario)
                }}
              >
                {!preset && <option value="custom">Custom experiment</option>}
                {presets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.number} / {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="file-actions">
              <button
                className="icon-button"
                onClick={save}
                aria-label="Save experiment"
                title="Save experiment"
              >
                <Save size={17} />
              </button>
              <button
                className="icon-button"
                onClick={() => importInput.current?.click()}
                aria-label="Import experiment"
                title="Import JSON"
              >
                <ArrowUpFromLine size={17} />
              </button>
              <button
                className="icon-button"
                onClick={() =>
                  download(
                    JSON.stringify(scenario, null, 2),
                    'cascade-experiment.json',
                    'application/json',
                  )
                }
                aria-label="Export experiment"
                title="Export JSON"
              >
                <ArrowDownToLine size={17} />
              </button>
              <button className="button share-button" onClick={() => void share()}>
                <Share2 size={15} />
                Share
              </button>
            </div>
          </div>
        </div>
        <input
          ref={importInput}
          className="sr-only"
          type="file"
          accept=".json,application/json"
          aria-label="Experiment JSON file"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            if (file.size > 32000) {
              setNotice('Experiment files must be smaller than 32 KB.')
              return
            }
            try {
              reset(parseScenario(await file.text()))
              setNotice('Experiment imported.')
            } catch (importError) {
              setNotice(
                importError instanceof Error
                  ? importError.message
                  : 'Could not read the experiment.',
              )
            }
          }}
        />
        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
            <button className="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        )}
        {view === 'lab' ? (
          <>
            <div className="metric-strip" aria-label="Current sample">
              <div>
                <span className="metric-label">
                  <Activity size={14} />
                  Successful throughput
                </span>
                <strong>
                  {pending ? '...' : count(frame?.throughput ?? 0)}
                  <small>req/s</small>
                </strong>
                <span className="metric-foot">{scenario.traffic} req/s offered before surge</span>
              </div>
              <div>
                <span className="metric-label">
                  <Clock3 size={14} />
                  P95 response
                </span>
                <strong className={(frame?.p95 ?? 0) >= scenario.timeout ? 'negative' : ''}>
                  {pending ? '...' : count(frame?.p95 ?? 0)}
                  <small>ms</small>
                </strong>
                <span className="metric-foot">{scenario.timeout} ms request timeout</span>
              </div>
              <div>
                <span className="metric-label">
                  <CircleAlert size={14} />
                  Error rate
                </span>
                <strong className={(frame?.errorRate ?? 0) > 1 ? 'negative' : ''}>
                  {pending ? '...' : (frame?.errorRate ?? 0).toFixed(1)}
                  <small>%</small>
                </strong>
                <span className="metric-foot">Completed requests in this second</span>
              </div>
              <div>
                <span className="metric-label">
                  <LayersIcon />
                  Queue depth
                </span>
                <strong>
                  {pending ? '...' : count(queued)}
                  <small>requests</small>
                </strong>
                <span className="metric-foot">Across {scenario.nodes.length} services</span>
              </div>
            </div>
            <div className="workspace-grid">
              <div className="lab-main">
                <div className={`run-status ${activeFault ? 'fault-active' : ''}`}>
                  <span>
                    {pending ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : activeFault ? (
                      <Zap size={14} />
                    ) : (
                      <span className={`status-dot ${playback.running ? 'healthy' : ''}`} />
                    )}
                    <strong>
                      {pending
                        ? 'Computing experiment'
                        : activeFault
                          ? `${scenario.nodes.find((node) => node.id === activeFault.target)?.name ?? 'Workload'} / ${activeFault.kind === 'latency' ? 'latency spike' : activeFault.kind === 'traffic' ? 'traffic surge' : 'offline'}`
                          : playback.time >= scenario.duration
                            ? 'Replay complete'
                            : playback.running
                              ? 'Replay running'
                              : 'Replay paused'}
                    </strong>
                  </span>
                  <button className="subtle-button" onClick={openControls}>
                    <SlidersHorizontal size={14} />
                    Parameters
                  </button>
                </div>
                <div className="topology-wrapper" aria-busy={pending}>
                  <Topology
                    scenario={scenario}
                    frame={frame}
                    playing={playback.running && !pending}
                    selected={selected}
                    onSelect={selectService}
                    onMove={(positions) =>
                      setScenario((current) => ({
                        ...current,
                        nodes: current.nodes.map((node) =>
                          positions.has(node.id)
                            ? {
                                ...node,
                                position: {
                                  x: Math.max(-2000, Math.min(4000, positions.get(node.id)!.x)),
                                  y: Math.max(-2000, Math.min(4000, positions.get(node.id)!.y)),
                                },
                              }
                            : node,
                        ),
                      }))
                    }
                    onConnect={(connection) => {
                      if (connection.source && connection.target)
                        connect(connection.source, connection.target)
                    }}
                    onAdd={addService}
                  />
                  {pending && (
                    <div className="computing-overlay">
                      <LoaderCircle className="spin" size={20} />
                      <span>Simulating requests</span>
                    </div>
                  )}
                </div>
                <section className="timeline" aria-label="Incident replay">
                  <div className="transport">
                    <div className="transport-buttons">
                      <button
                        className="play-button"
                        disabled={pending || !!error}
                        aria-label={playback.running ? 'Pause replay' : 'Play replay'}
                        onClick={() =>
                          setPlayback((current) => ({
                            ...current,
                            time: current.time >= scenario.duration ? 0 : current.time,
                            running: !current.running,
                          }))
                        }
                      >
                        {playback.running ? (
                          <Pause size={16} fill="currentColor" />
                        ) : (
                          <Play size={16} fill="currentColor" />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => seek(0)}
                        aria-label="Reset replay"
                        title="Reset replay"
                      >
                        <RotateCcw size={16} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => seek(playback.time - 1)}
                        aria-label="Previous second"
                        title="Previous second"
                      >
                        <SkipBack size={15} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => seek(playback.time + 1)}
                        aria-label="Next second"
                        title="Next second"
                      >
                        <SkipForward size={15} />
                      </button>
                      <span className="replay-clock">
                        {formatTime(playback.time)}
                        <span> / {formatTime(scenario.duration)}</span>
                      </span>
                    </div>
                    <div className="transport-options">
                      <div
                        className="segmented speed-options"
                        role="group"
                        aria-label="Replay speed"
                      >
                        {[1, 2, 4].map((rate) => (
                          <button
                            key={rate}
                            aria-pressed={playback.rate === rate}
                            onClick={() => setPlayback((current) => ({ ...current, rate }))}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                      <button
                        className="icon-button seed-button"
                        onClick={() => {
                          const values = new Uint32Array(1)
                          crypto.getRandomValues(values)
                          update({ ...scenario, seed: (values[0] % 999999) + 1 })
                          seek(0)
                        }}
                        aria-label="Randomize seed"
                        title="Randomize seed"
                      >
                        <Shuffle size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="timeline-track">
                    <input
                      type="range"
                      aria-label="Replay position"
                      aria-valuetext={`${formatTime(playback.time)} of ${formatTime(scenario.duration)}`}
                      min={0}
                      max={scenario.duration}
                      step={1}
                      value={Math.floor(playback.time)}
                      onChange={(event) => seek(Number(event.target.value))}
                    />
                    {scenario.faults.map((fault, index) => (
                      <span
                        className="fault-window"
                        key={index}
                        style={{
                          left: `${(fault.start / scenario.duration) * 100}%`,
                          width: `${(fault.duration / scenario.duration) * 100}%`,
                        }}
                        title={`${fault.kind}: ${formatTime(fault.start)} to ${formatTime(fault.start + fault.duration)}`}
                      />
                    ))}
                  </div>
                  <div className="timeline-ticks">
                    {[0, 0.1667, 0.3333, 0.5, 0.6667, 0.8333, 1].map((fraction) => (
                      <span key={fraction}>
                        {formatTime(Math.round(scenario.duration * fraction))}
                      </span>
                    ))}
                  </div>
                  <div className="timeline-caption">
                    <span>
                      <i />
                      Fault window
                    </span>
                    <span>
                      {scenario.faults.length
                        ? `${formatTime(scenario.faults[0].start)} to ${formatTime(scenario.faults[0].start + scenario.faults[0].duration)}`
                        : 'No faults scheduled'}
                    </span>
                  </div>
                </section>
                {result && (
                  <Telemetry
                    frames={result.frames}
                    cursor={playback.time}
                    faults={scenario.faults}
                  />
                )}
              </div>
              <Inspector
                scenario={scenario}
                selected={selected}
                mode={inspectorMode}
                setMode={setInspectorMode}
                update={update}
                onInject={inject}
                onDelete={deleteService}
                onConnect={connect}
              />
            </div>
            <section className="incident-section">
              <div className="section-heading">
                <div>
                  <h2>Incident log</h2>
                  <span className="muted">
                    {visibleIncidents.length
                      ? 'Observed events at this point in the replay'
                      : 'No events yet'}
                  </span>
                </div>
                <button
                  className="subtle-button"
                  disabled={!result || pending}
                  onClick={exportBrief}
                >
                  <FileJson size={15} />
                  Export brief
                  <ArrowUpRight size={13} />
                </button>
              </div>
              <div className="incident-list">
                {visibleIncidents.map((incident, index) => (
                  <div className="incident-row" key={`${incident.time}:${index}`}>
                    <time>{formatTime(incident.time)}</time>
                    <span className={`event-marker ${incident.severity}`} />
                    <strong>
                      {scenario.nodes.find((node) => node.id === incident.node)?.name ??
                        incident.node}
                    </strong>
                    <span>{incident.message}</span>
                  </div>
                ))}
              </div>
            </section>
            <div className="compare-prompt">
              <div>
                <GitCompareArrows size={22} />
                <div>
                  <strong>
                    Current run vs.{' '}
                    {scenario.breaker ? 'no circuit breaker' : 'circuit breaker + jitter'}
                  </strong>
                  <span>Same seed / same external workload</span>
                </div>
              </div>
              <button
                className="button"
                disabled={!result || !comparison || pending}
                onClick={() => {
                  setView('compare')
                  setPlayback((current) => ({ ...current, running: false }))
                  window.scrollTo({ top: 0, behavior: 'instant' })
                }}
              >
                Compare outcomes
                <ArrowUpRight size={15} />
              </button>
            </div>
          </>
        ) : (
          result &&
          comparison && (
            <Comparison
              scenario={scenario}
              result={result}
              comparison={comparison}
              onApply={(next) => {
                reset(next)
                setNotice('Comparison controls applied.')
              }}
              onExport={exportBrief}
            />
          )
        )}
      </main>
      <footer className="app-footer">
        <span>
          <Workflow size={14} />
          Cascade<span className="footer-divider">/</span>Discrete-event model v1.0
        </span>
        <a href="https://marcusfelling.com" target="_blank" rel="noreferrer">
          Built by Marcus Felling
          <ArrowUpRight size={12} />
        </a>
        <a
          href="https://github.com/MarcusFelling/cascade#model-boundaries"
          target="_blank"
          rel="noreferrer"
        >
          Model & assumptions
          <ArrowUpRight size={12} />
        </a>
      </footer>
      <div className="notice-region" role="status" aria-live="polite">
        {notice && (
          <div className="toast">
            <Check size={17} />
            <span>{notice}</span>
            <button
              className="icon-button"
              onClick={() => setNotice('')}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
      <dialog className="share-dialog" ref={shareDialog} aria-labelledby="share-title">
        <form method="dialog">
          <div className="section-heading">
            <h2 id="share-title">Share experiment</h2>
            <button className="icon-button" aria-label="Close share dialog">
              <X size={18} />
            </button>
          </div>
          <label className="select-field">
            Reproducible link
            <input readOnly value={shareLink} onFocus={(event) => event.target.select()} />
          </label>
          <button
            className="button"
            type="button"
            onClick={() => {
              shareDialog.current?.querySelector('input')?.select()
            }}
          >
            Select link
          </button>
        </form>
      </dialog>
    </div>
  )
}

function LayersIcon() {
  return <ShieldCheck size={14} />
}
