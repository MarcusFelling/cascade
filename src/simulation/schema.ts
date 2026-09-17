import { z } from 'zod'

export const nodeSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/),
    name: z.string().trim().min(1).max(24),
    kind: z.enum(['gateway', 'service', 'cache', 'database']),
    replicas: z.number().int().min(1).max(8),
    concurrency: z.number().int().min(1).max(64),
    latency: z.number().min(2).max(200),
    hitRate: z.number().min(0).max(0.95),
    position: z.object({ x: z.number().min(-2000).max(4000), y: z.number().min(-2000).max(4000) }),
  })
  .strict()

export const scenarioSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(60),
    seed: z.number().int().min(1).max(999999),
    duration: z.number().int().min(30).max(120),
    traffic: z.number().int().min(10).max(300),
    timeout: z.number().int().min(100).max(3000),
    retries: z.number().int().min(0).max(3),
    retryDelay: z.number().int().min(10).max(1000),
    jitter: z.boolean(),
    breaker: z.boolean(),
    nodes: z.array(nodeSchema).min(2).max(10),
    edges: z
      .array(z.object({ source: z.string(), target: z.string() }).strict())
      .min(1)
      .max(16),
    faults: z
      .array(
        z
          .object({
            target: z.string(),
            kind: z.enum(['latency', 'outage', 'traffic']),
            start: z.number().int().min(1),
            duration: z.number().int().min(1),
            multiplier: z.number().min(2).max(30),
          })
          .strict(),
      )
      .max(4),
  })
  .strict()
  .superRefine((scenario, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message })
    const ids = new Set(scenario.nodes.map((node) => node.id))
    if (ids.size !== scenario.nodes.length) issue('Service IDs must be unique.')
    const gateways = scenario.nodes.filter((node) => node.kind === 'gateway')
    if (gateways.length !== 1) issue('An architecture needs exactly one gateway.')
    const connections = new Set<string>()
    for (const edge of scenario.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target))
        issue('A connection references a missing service.')
      const key = `${edge.source}:${edge.target}`
      if (connections.has(key)) issue('Duplicate connections are not supported.')
      connections.add(key)
    }
    const visited = new Set<string>()
    const visiting = new Set<string>()
    let cyclic = false
    const visit = (id: string) => {
      if (visiting.has(id)) {
        cyclic = true
        return
      }
      if (visited.has(id)) return
      visiting.add(id)
      for (const edge of scenario.edges.filter((edge) => edge.source === id)) visit(edge.target)
      visiting.delete(id)
      visited.add(id)
    }
    for (const id of ids) visit(id)
    if (cyclic) issue('Circular dependencies are not supported.')
    visited.clear()
    if (gateways[0]) visit(gateways[0].id)
    if (visited.size !== ids.size) issue('Every service must be reachable from the gateway.')
    for (const fault of scenario.faults) {
      if (!ids.has(fault.target)) issue('A fault references a missing service.')
      if (fault.start + fault.duration > scenario.duration)
        issue('A fault must end within the experiment.')
    }
  })

export type Service = z.infer<typeof nodeSchema>
export type Scenario = z.infer<typeof scenarioSchema>
export type Fault = Scenario['faults'][number]

export const defaultScenario: Scenario = {
  version: 1,
  name: 'The retry storm',
  seed: 42,
  duration: 90,
  traffic: 90,
  timeout: 800,
  retries: 2,
  retryDelay: 60,
  jitter: false,
  breaker: false,
  nodes: [
    {
      id: 'gateway',
      name: 'Gateway',
      kind: 'gateway',
      replicas: 2,
      concurrency: 48,
      latency: 4,
      hitRate: 0,
      position: { x: 0, y: 150 },
    },
    {
      id: 'checkout',
      name: 'Checkout API',
      kind: 'service',
      replicas: 2,
      concurrency: 32,
      latency: 12,
      hitRate: 0,
      position: { x: 230, y: 150 },
    },
    {
      id: 'catalog',
      name: 'Catalog',
      kind: 'service',
      replicas: 2,
      concurrency: 24,
      latency: 8,
      hitRate: 0,
      position: { x: 460, y: 20 },
    },
    {
      id: 'payments',
      name: 'Payments',
      kind: 'service',
      replicas: 2,
      concurrency: 24,
      latency: 20,
      hitRate: 0,
      position: { x: 460, y: 280 },
    },
    {
      id: 'cache',
      name: 'Redis cache',
      kind: 'cache',
      replicas: 1,
      concurrency: 48,
      latency: 3,
      hitRate: 0.7,
      position: { x: 690, y: 20 },
    },
    {
      id: 'database',
      name: 'Postgres',
      kind: 'database',
      replicas: 1,
      concurrency: 8,
      latency: 18,
      hitRate: 0,
      position: { x: 690, y: 280 },
    },
  ],
  edges: [
    { source: 'gateway', target: 'checkout' },
    { source: 'checkout', target: 'catalog' },
    { source: 'checkout', target: 'payments' },
    { source: 'catalog', target: 'cache' },
    { source: 'cache', target: 'database' },
    { source: 'payments', target: 'database' },
  ],
  faults: [{ target: 'database', kind: 'latency', start: 20, duration: 25, multiplier: 24 }],
}

export const presets = [
  {
    id: 'retry-storm',
    number: '01',
    name: 'The retry storm',
    label: 'Latency injection',
    scenario: defaultScenario,
  },
  {
    id: 'traffic-surge',
    number: '02',
    name: 'Flash crowd',
    label: 'Traffic surge',
    scenario: {
      ...defaultScenario,
      name: 'Flash crowd',
      traffic: 160,
      faults: [
        { target: 'gateway', kind: 'traffic' as const, start: 20, duration: 30, multiplier: 3 },
      ],
    },
  },
  {
    id: 'cache-outage',
    number: '03',
    name: 'Cache blackout',
    label: 'Service outage',
    scenario: {
      ...defaultScenario,
      name: 'Cache blackout',
      faults: [
        { target: 'cache', kind: 'outage' as const, start: 20, duration: 20, multiplier: 2 },
      ],
    },
  },
  {
    id: 'payment-latency',
    number: '04',
    name: 'The slow dependency',
    label: 'Dependency failure',
    scenario: {
      ...defaultScenario,
      name: 'The slow dependency',
      faults: [
        { target: 'payments', kind: 'latency' as const, start: 20, duration: 25, multiplier: 30 },
      ],
    },
  },
] satisfies { id: string; number: string; name: string; label: string; scenario: Scenario }[]
