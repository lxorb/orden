interface Internals {
  invoke: (command: string) => Promise<unknown>
}

const internals = (window as unknown as { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__

if (internals) {
  Object.assign(window, {
    nibEarly: internals.invoke('launch_ahead').catch(() => null),
    nibOutside: internals.invoke('outside_spaces').catch(() => null),
  })
}
