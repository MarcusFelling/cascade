import { Sim } from 'simts'
import seedrandom from 'seedrandom'
import { scenarioSchema, type Scenario, type Service } from './schema'

export type ServiceState = 'healthy' | 'saturated' | 'degraded' | 'down' | 'open'
export type Incident = {
  time: number
  node: string
  message: string
  severity: 'info' | 'warning' | 'critical'
}
export type NodeFrame = {
  active: number
  queued: number
  load: number
  requests: number
  errors: number
  state: ServiceState
  breaker: 'closed' | 'open' | 'half-open'
}
export type Frame = {
  time: number
  arrivals: number
  throughput: number
  errors: number
  errorRate: number
  p95: number
  retries: number
  inFlight: number
  nodes: Record<string, NodeFrame>
}
export type SimulationResult = {
  frames: Frame[]
  incidents: Incident[]
  summary: {
    arrivals: number
    successful: number
    failed: number
    pending: number
    availability: number
    p95: number
    retries: number
    peakQueue: number
    recovery: number | null
    events: number
  }
}

type Outcome = 'ok' | 'timeout' | 'failure' | 'open' | 'overload'
type Reply = (outcome: Outcome) => void
type Job = { responded: boolean; begin: () => void }
type Runtime = {
  service: Service
  active: number
  queue: Job[]
  requests: number
  errors: number
  consecutiveFailures: number
  openUntil: number
  probing: boolean
  lastState: ServiceState
  random: seedrandom.PRNG
}

const percentile = (values: number[], fraction = 0.95) => {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)])
}

export function simulate(input: Scenario): SimulationResult {
  const scenario = scenarioSchema.parse(input)
  const clock = new Sim()
  const arrivalRandom = seedrandom(`${scenario.seed}:arrivals`)
  const retryRandom = seedrandom(`${scenario.seed}:retries`)
  const frames: Frame[] = []
  const incidents: Incident[] = []
  const latencies: number[] = []
  const runtimes = new Map<string, Runtime>(
    scenario.nodes.map((service) => [
      service.id,
      {
        service,
        active: 0,
        queue: [],
        requests: 0,
        errors: 0,
        consecutiveFailures: 0,
        openUntil: 0,
        probing: false,
        lastState: 'healthy',
        random: seedrandom(`${scenario.seed}:${service.id}`),
      },
    ]),
  )
  const children = new Map(
    scenario.nodes.map((service) => [
      service.id,
      scenario.edges.filter((edge) => edge.source === service.id).map((edge) => edge.target),
    ]),
  )
  const root = scenario.nodes.find((service) => service.kind === 'gateway')!.id
  const duration = scenario.duration * 1000
  let arrivals = 0
  let successful = 0
  let failed = 0
  let pending = 0
  let totalRetries = 0
  let peakQueue = 0
  let operations = 0
  let finished = false
  let windowArrivals = 0
  let windowSuccessful = 0
  let windowFailed = 0
  let windowRetries = 0
  let windowLatencies: number[] = []

  const schedule = (delay: number, action: () => void) =>
    clock.setTimer(Math.max(0, delay)).done(action)
  const log = (node: string, message: string, severity: Incident['severity']) => {
    if (incidents.length < 500)
      incidents.push({ time: Math.round(clock.time()) / 1000, node, message, severity })
  }
  const activeFaults = (id: string) =>
    scenario.faults.filter(
      (fault) =>
        fault.target === id &&
        clock.time() >= fault.start * 1000 &&
        clock.time() < (fault.start + fault.duration) * 1000,
    )

  const callWithRetry = (id: string, reply: Reply, attempt = 0) => {
    invoke(id, (outcome) => {
      const leaf = children.get(id)!.length === 0
      if (outcome !== 'ok' && outcome !== 'open' && leaf && attempt < scenario.retries) {
        const delay =
          scenario.retryDelay * (scenario.jitter ? 2 ** attempt * (0.5 + retryRandom()) : 1)
        schedule(delay, () => {
          totalRetries++
          windowRetries++
          callWithRetry(id, reply, attempt + 1)
        })
      } else reply(outcome)
    })
  }

  const invoke = (id: string, reply: Reply) => {
    const runtime = runtimes.get(id)!
    const service = runtime.service
    const isLeaf = children.get(id)!.length === 0
    const protectedCall = scenario.breaker && isLeaf
    if (protectedCall && (runtime.openUntil > clock.time() || runtime.probing)) {
      reply('open')
      return
    }
    const isProbe = protectedCall && runtime.openUntil > 0
    if (isProbe) runtime.probing = true
    runtime.requests++
    const job: Job = { responded: false, begin: () => {} }
    const respond: Reply = (outcome) => {
      if (job.responded) return
      job.responded = true
      if (outcome !== 'ok') runtime.errors++
      if (protectedCall) {
        if (outcome === 'ok') {
          runtime.consecutiveFailures = 0
          if (isProbe) {
            runtime.openUntil = 0
            runtime.probing = false
            log(id, 'Probe succeeded. Circuit closed.', 'info')
          }
        } else {
          runtime.consecutiveFailures++
          if ((runtime.consecutiveFailures >= 5 && runtime.openUntil <= clock.time()) || isProbe) {
            runtime.openUntil = clock.time() + 4000
            runtime.probing = false
            log(id, 'Circuit opened. Requests fail fast for 4s.', 'warning')
          }
        }
      }
      reply(outcome)
    }
    const pump = () => {
      while (runtime.active < service.replicas * service.concurrency && runtime.queue.length) {
        const next = runtime.queue.shift()!
        if (!next.responded) next.begin()
      }
    }
    const finish: Reply = (outcome) => {
      runtime.active--
      respond(outcome)
      pump()
    }
    job.begin = () => {
      runtime.active++
      const faults = activeFaults(id)
      const multiplier = faults.reduce(
        (value, fault) => (fault.kind === 'latency' ? Math.max(value, fault.multiplier) : value),
        1,
      )
      const outage = faults.some((fault) => fault.kind === 'outage')
      const processing = service.latency * (0.65 + runtime.random() * 0.7) * multiplier
      schedule(processing, () => {
        if (outage) {
          finish('failure')
          return
        }
        if (service.kind === 'cache' && runtime.random() < service.hitRate) {
          finish('ok')
          return
        }
        const dependencies = children.get(id)!
        if (!dependencies.length) {
          finish('ok')
          return
        }
        let outstanding = dependencies.length
        let result: Outcome = 'ok'
        for (const dependency of dependencies) {
          callWithRetry(dependency, (outcome) => {
            if (outcome !== 'ok') result = outcome
            outstanding--
            if (outstanding === 0) finish(result)
          })
        }
      })
    }
    schedule(scenario.timeout, () => respond('timeout'))
    if (runtime.active < service.replicas * service.concurrency) job.begin()
    else if (runtime.queue.filter((queued) => !queued.responded).length < 80)
      runtime.queue.push(job)
    else respond('overload')
  }

  const sample = (time: number) => {
    const nodes: Frame['nodes'] = {}
    for (const [id, runtime] of runtimes) {
      runtime.queue = runtime.queue.filter((job) => !job.responded)
      const queued = runtime.queue.length
      peakQueue = Math.max(peakQueue, queued)
      const load = Math.min(
        100,
        Math.round(
          (runtime.active / (runtime.service.replicas * runtime.service.concurrency)) * 100,
        ),
      )
      const faults = activeFaults(id)
      const state: ServiceState =
        runtime.openUntil > clock.time()
          ? 'open'
          : faults.some((fault) => fault.kind === 'outage')
            ? 'down'
            : faults.some((fault) => fault.kind === 'latency')
              ? 'degraded'
              : queued > 0
                ? 'saturated'
                : 'healthy'
      if (state === 'saturated' && runtime.lastState !== state)
        log(id, `Queue building: ${queued} requests waiting.`, 'warning')
      runtime.lastState = state
      nodes[id] = {
        active: runtime.active,
        queued,
        load,
        requests: runtime.requests,
        errors: runtime.errors,
        state,
        breaker: runtime.probing
          ? 'half-open'
          : runtime.openUntil > clock.time()
            ? 'open'
            : 'closed',
      }
      runtime.requests = 0
      runtime.errors = 0
    }
    const completed = windowSuccessful + windowFailed
    frames.push({
      time,
      arrivals: windowArrivals,
      throughput: windowSuccessful,
      errors: windowFailed,
      errorRate: completed ? (windowFailed / completed) * 100 : 0,
      p95: percentile(windowLatencies),
      retries: windowRetries,
      inFlight: pending,
      nodes,
    })
    windowArrivals = windowSuccessful = windowFailed = windowRetries = 0
    windowLatencies = []
  }

  const arrive = () => {
    const multiplier = scenario.faults
      .filter(
        (fault) =>
          fault.kind === 'traffic' &&
          clock.time() >= fault.start * 1000 &&
          clock.time() < (fault.start + fault.duration) * 1000,
      )
      .reduce((value, fault) => Math.max(value, fault.multiplier), 1)
    const interval = (-Math.log(1 - arrivalRandom()) * 1000) / (scenario.traffic * multiplier)
    if (clock.time() + interval >= duration) return
    schedule(interval, () => {
      arrivals++
      pending++
      windowArrivals++
      const started = clock.time()
      invoke(root, (outcome) => {
        pending--
        const latency = clock.time() - started
        latencies.push(latency)
        windowLatencies.push(latency)
        if (outcome === 'ok') {
          successful++
          windowSuccessful++
        } else {
          failed++
          windowFailed++
        }
      })
      arrive()
    })
  }

  log(root, `${scenario.traffic} requests/s. Seed ${scenario.seed}.`, 'info')
  for (const fault of scenario.faults) {
    schedule(fault.start * 1000, () =>
      log(
        fault.target,
        fault.kind === 'outage'
          ? 'Service offline.'
          : fault.kind === 'traffic'
            ? `Traffic increased ${fault.multiplier}x.`
            : `Processing latency increased ${fault.multiplier}x.`,
        'critical',
      ),
    )
    schedule((fault.start + fault.duration) * 1000, () =>
      log(fault.target, 'Fault cleared. Recovery begins.', 'info'),
    )
  }
  sample(0)
  for (let second = 1; second <= scenario.duration; second++)
    schedule(second * 1000, () => sample(second))
  schedule(duration, () => {
    finished = true
  })
  arrive()
  while (!finished && clock.step()) {
    operations++
    if (operations > 2_000_000)
      throw new Error('Experiment exceeded the event limit. Reduce traffic, retries, or duration.')
  }
  const completed = successful + failed
  const lastFaultEnd = Math.max(0, ...scenario.faults.map((fault) => fault.start + fault.duration))
  const recovered = frames.find(
    (frame, index) =>
      frame.time >= lastFaultEnd &&
      frame.time > 0 &&
      frames.slice(index, index + 3).length === 3 &&
      frames
        .slice(index, index + 3)
        .every(
          (sample) =>
            sample.errorRate < 1 &&
            sample.throughput > 0 &&
            Object.values(sample.nodes).every((node) => node.queued === 0),
        ),
  )
  return {
    frames,
    incidents,
    summary: {
      arrivals,
      successful,
      failed,
      pending,
      availability: completed ? (successful / completed) * 100 : 100,
      p95: percentile(latencies),
      retries: totalRetries,
      peakQueue,
      recovery: scenario.faults.length && recovered ? recovered.time - lastFaultEnd : null,
      events: operations,
    },
  }
}
