import { providePort } from '@orden/contracts'

providePort('backend.web', {
  invoke: async <T>(command: string, args?: Record<string, unknown>) => {
    const { webInvoke } = await import('./web/commands')
    return webInvoke<T>(command, args)
  },
})

providePort('backend.internal', {
  invoke: async <T>(command: string, args?: Record<string, unknown>) => {
    const { internalInvoke } = await import('./internal/route')
    return internalInvoke<T>(command, args)
  },
})
