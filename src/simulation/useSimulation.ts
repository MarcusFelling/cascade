import { useEffect, useState } from 'react'
import type { SimulationResult } from './engine'
import type { Scenario } from './schema'
import type { WorkerResponse } from './simulation.worker'

type State = {
  result: SimulationResult | null
  comparison: SimulationResult | null
  pending: boolean
  error: string
  key: string
}

export function useSimulation(scenario: Scenario) {
  const key = JSON.stringify({
    ...scenario,
    nodes: scenario.nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } })),
  })
  const [state, setState] = useState<State>({
    result: null,
    comparison: null,
    pending: true,
    error: '',
    key: '',
  })

  useEffect(() => {
    const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
      type: 'module',
    })
    const timeout = window.setTimeout(() => {
      worker.terminate()
      setState({
        result: null,
        comparison: null,
        pending: false,
        error: 'The simulation exceeded 15 seconds. Reduce the workload and try again.',
        key,
      })
    }, 15000)
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      window.clearTimeout(timeout)
      if ('error' in event.data)
        setState({ result: null, comparison: null, pending: false, error: event.data.error, key })
      else setState({ ...event.data, pending: false, error: '', key })
      worker.terminate()
    }
    worker.onerror = () => {
      window.clearTimeout(timeout)
      setState({
        result: null,
        comparison: null,
        pending: false,
        error: 'The simulation worker failed to load. Reload the page to retry.',
        key,
      })
      worker.terminate()
    }
    worker.postMessage(JSON.parse(key))
    return () => {
      window.clearTimeout(timeout)
      worker.terminate()
    }
  }, [key])

  return { ...state, pending: state.key !== key || state.pending }
}
