import { onEngines } from '@orden/markdown/engines'

let arrived = $state(0)

onEngines(() => {
  arrived += 1
})

export function enginesArrived(): number {
  return arrived
}
