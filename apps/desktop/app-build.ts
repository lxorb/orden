import left from './left-out.json'

export const ORDEN_APPS = ['orden', 'notes', 'todo', 'chat', 'track'] as const
export type OrdenApp = (typeof ORDEN_APPS)[number]
export function ordenApp(said = process.env.ORDEN_APP ?? ''): OrdenApp {
  if (!said) return 'orden'
  const app = ORDEN_APPS.find((one) => one === said)
  if (!app) throw new Error(`ORDEN_APP=${said} is not one of ${ORDEN_APPS.join(', ')}`)
  return app
}
export function distOf(app: OrdenApp): string {
  return app === 'orden' ? 'dist' : `dist-${app}`
}
export function entryOf(app: OrdenApp): string {
  return app === 'orden' || app === 'notes' ? 'index.html' : `${app}.html`
}
export function leftOut(app: OrdenApp): readonly string[] {
  return (left as Partial<Record<OrdenApp, readonly string[]>>)[app] ?? []
}
