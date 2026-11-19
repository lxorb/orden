import { steadyEnv, type Env } from '../../../sync-server/src/api'

const GONE = 4404
export class AppRelay implements DurableObject {
  readonly env: Env
  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
  ) {
    this.env = steadyEnv(env)
  }
  fetch(): Response {
    return new Response('applications are not hosted here any more', { status: 404 })
  }
  webSocketMessage(socket: WebSocket): void {
    socket.close(GONE, 'applications are not hosted here any more')
  }
  alarm(): void {
    for (const socket of this.ctx.getWebSockets()) socket.close(GONE, 'applications are not hosted here any more')
  }
}
