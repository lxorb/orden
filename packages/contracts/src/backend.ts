export interface BackendPort {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

export interface BackendPorts {
  readonly 'backend.web': BackendPort
  readonly 'backend.internal': BackendPort
}
