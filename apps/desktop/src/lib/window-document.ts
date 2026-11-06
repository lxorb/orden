export interface Showing {
  shown: string
  path: string | null
  draft?: boolean
}

export interface WindowDocument {
  title: string
  edited: boolean
  path: string | null
}

const APP = 'Orden'

export function windowDocument(active: Showing | null, mac: boolean): WindowDocument {
  if (!active) return { title: APP, edited: false, path: null }

  if (mac) {
    const path = active.path?.startsWith('/') ? active.path : null
    return { title: active.shown, edited: active.draft === true, path }
  }

  return { title: `${active.shown} - ${APP}`, edited: false, path: null }
}
