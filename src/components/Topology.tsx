import { useEffect, useState } from 'react'
import { Activity, Box, Database, Layers3, Network, Plus } from 'lucide-react'
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useReactFlow,
  useStore,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Frame, NodeFrame } from '../simulation/engine'
import type { Scenario, Service } from '../simulation/schema'

const stateNames = {
  healthy: 'Healthy',
  saturated: 'Saturated',
  degraded: 'Slow',
  down: 'Offline',
  open: 'Circuit open',
}
const icons = { gateway: Network, service: Box, cache: Layers3, database: Database }
type ServiceNode = Node<{ service: Service; snapshot?: NodeFrame; portrait: boolean }, 'service'>
type TrafficEdge = Edge<{ moving: boolean; trouble: boolean; traffic: number }, 'traffic'>

function ServiceTile({ data, selected }: NodeProps<ServiceNode>) {
  const { service, snapshot, portrait } = data
  const Icon = icons[service.kind]
  const state = snapshot?.state ?? 'healthy'
  return (
    <div
      className={`service-node ${state} ${selected ? 'is-selected' : ''}`}
      data-testid={`service-${service.id}`}
    >
      <Handle type="target" position={portrait ? Position.Top : Position.Left} />
      <div className="service-heading">
        <span className="service-icon">
          <Icon size={19} strokeWidth={1.65} />
        </span>
        <span className="replica-count">{service.replicas}x</span>
      </div>
      <strong className="service-name">{service.name}</strong>
      <div className="service-state">
        <span className={`status-dot ${state}`} />
        {stateNames[state]}
      </div>
      <div className="service-load">
        <span style={{ width: `${snapshot?.load ?? 0}%` }} />
      </div>
      <div className="service-stats">
        <span>
          {snapshot?.active ?? 0}
          <span className="stat-caption"> in flight</span>
        </span>
        <span>
          {snapshot?.queued ?? 0}
          <span className="stat-caption"> queued</span>
        </span>
      </div>
      <Handle type="source" position={portrait ? Position.Bottom : Position.Right} />
    </div>
  )
}

function RequestEdge(props: EdgeProps<TrafficEdge>) {
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 18,
  })
  const color = props.data?.trouble ? 'var(--cp-accent)' : 'var(--cp-border-strong)'
  return (
    <>
      <BaseEdge path={path} style={{ stroke: color, strokeWidth: 1.5, opacity: 0.7 }} />
      {props.data?.moving && props.data.traffic > 0 && (
        <g className="request-particles" aria-hidden="true">
          <circle r="3.2" fill={props.data.trouble ? 'var(--cp-accent)' : 'var(--cp-success)'}>
            <animateMotion dur="2.2s" repeatCount="indefinite" path={path} />
          </circle>
          <circle
            r="2.3"
            fill={props.data.trouble ? 'var(--cp-accent)' : 'var(--cp-success)'}
            opacity="0.65"
          >
            <animateMotion dur="2.2s" begin="-1.1s" repeatCount="indefinite" path={path} />
          </circle>
        </g>
      )}
    </>
  )
}

const nodeTypes = { service: ServiceTile }
const edgeTypes = { traffic: RequestEdge }

function AutoFit({ layoutKey }: { layoutKey: string }) {
  const { fitView, getNodes } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const viewportSize = useStore((state) => `${state.width}:${state.height}`)
  useEffect(() => {
    void fitView({ padding: 0.14, duration: 0 }).then(() => {
      updateNodeInternals(getNodes().map((node) => node.id))
    })
  }, [layoutKey, viewportSize, fitView, getNodes, updateNodeInternals])
  return null
}

type Props = {
  scenario: Scenario
  frame?: Frame
  playing: boolean
  selected: string
  onSelect: (id: string) => void
  onMove: (positions: Map<string, { x: number; y: number }>) => void
  onConnect: (connection: Connection) => void
  onAdd: () => void
}

export function Topology({
  scenario,
  frame,
  playing,
  selected,
  onSelect,
  onMove,
  onConnect,
  onAdd,
}: Props) {
  const [portrait, setPortrait] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({})
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    const change = () => setPortrait(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  const portraitPositions = [
    { x: 106, y: 0 },
    { x: 106, y: 165 },
    { x: 0, y: 340 },
    { x: 212, y: 340 },
    { x: 0, y: 530 },
    { x: 212, y: 530 },
  ]
  const nodes: ServiceNode[] = scenario.nodes.map((service, index) => ({
    id: service.id,
    type: 'service',
    selected: service.id === selected,
    measured: measurements[service.id],
    position: portrait
      ? (portraitPositions[index] ?? {
          x: (index % 2) * 212,
          y: 720 + Math.floor((index - 6) / 2) * 190,
        })
      : service.position,
    data: { service, snapshot: frame?.nodes[service.id], portrait },
    ariaLabel: `${service.name}, ${stateNames[frame?.nodes[service.id]?.state ?? 'healthy']}`,
  }))
  const edges: TrafficEdge[] = scenario.edges.map((edge) => {
    const state = frame?.nodes[edge.target]
    return {
      ...edge,
      id: `${edge.source}-${edge.target}`,
      type: 'traffic',
      data: {
        moving: playing,
        trouble: !!state && state.state !== 'healthy',
        traffic: state?.requests ?? 0,
      },
    }
  })
  const move = (changes: NodeChange<ServiceNode>[]) => {
    const dimensionChanges = changes.filter((change) => change.type === 'dimensions')
    if (dimensionChanges.length) {
      setMeasurements((current) => {
        const next = { ...current }
        for (const change of dimensionChanges) {
          if (change.dimensions) next[change.id] = change.dimensions
        }
        return next
      })
    }
    const positions = new Map<string, { x: number; y: number }>()
    for (const change of changes)
      if (change.type === 'position' && change.position && !portrait)
        positions.set(change.id, change.position)
    if (positions.size) onMove(positions)
  }
  return (
    <section className="topology" aria-label="Service topology">
      <div className="topology-toolbar">
        <div>
          <Activity size={14} />
          <span className="eyebrow">Service topology</span>
          <span className="topology-count">
            {nodes.length} services / {edges.length} dependencies
          </span>
        </div>
        <button className="subtle-button" onClick={onAdd} disabled={nodes.length >= 10}>
          <Plus size={15} />
          Add service
        </button>
      </div>
      <div className="topology-canvas">
        <ReactFlow<ServiceNode, TrafficEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={move}
          onNodeClick={(_, node) => onSelect(node.id)}
          onConnect={onConnect}
          fitView
          fitViewOptions={{ padding: 0.14 }}
          minZoom={0.25}
          maxZoom={1.8}
          nodesDraggable={!portrait}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          connectionLineStyle={{ stroke: 'var(--cp-accent)', strokeWidth: 2 }}
          onlyRenderVisibleElements={false}
        >
          <Background gap={22} size={1} color="var(--cp-border)" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor="var(--cp-border-strong)"
            maskColor="var(--cp-overlay)"
          />
          <AutoFit layoutKey={`${portrait}:${scenario.nodes.map((node) => node.id).join(',')}`} />
        </ReactFlow>
      </div>
      <div className="topology-legend">
        <span>
          <i className="status-dot healthy" />
          Healthy
        </span>
        <span>
          <i className="status-dot saturated" />
          Saturated
        </span>
        <span>
          <i className="status-dot degraded" />
          Faulted
        </span>
        <span className="topology-legend-note">Required dependencies</span>
      </div>
    </section>
  )
}
