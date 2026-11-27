import { type ChatPlaces, portOf } from '@orden/contracts'

let loading: Promise<ChatPlaces | null> | null = null
export function places(): Promise<ChatPlaces | null> {
  if (loading) return loading
  const port = portOf('chats.places')
  if (!port.ok) return Promise.resolve(null)
  loading = port.value.load()
  return loading
}
