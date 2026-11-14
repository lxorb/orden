import { MATERIAL_KEY, rememberGround } from './ground'
import { forget, keep, invoke, isDesktop } from '../../platform/src/api'

let worn: { on: boolean; dark: boolean; kind: string } | null = null
let standing: string | null = null
let pending = false
let keeping = false
let asked = 0

function say(kind: string | null): void {
  standing = kind
  const said = document.documentElement.dataset
  if (kind) said.translucent = kind
  else delete said.translucent
}

function remember(): void {
  if (standing) keep(MATERIAL_KEY, standing)
  else forget(MATERIAL_KEY)
  rememberGround()
  if (standing && worn) void invoke('remember_material', { kind: worn.kind }).catch(() => undefined)
}

export function wearMaterial(on: boolean, dark: boolean, kept: boolean, kind = 'mica-alt'): void {
  if (!isDesktop) return

  if (worn?.on === on && worn.dark === dark && worn.kind === kind) {
    if (pending) {
      keeping ||= kept
      return
    }
    say(standing)
    if (kept) remember()
    return
  }

  worn = { on, dark, kind }
  keeping = kept
  const asking = ++asked

  if (!on) {
    pending = false
    say(null)
    if (keeping) remember()
    void invoke('set_translucency', { on: false, dark }).catch(() => undefined)
    return
  }

  pending = true
  const answered = (kind: string | null) => {
    if (asking !== asked) return
    pending = false
    say(kind)
    if (keeping) remember()
  }
  void invoke<string>('set_translucency', { on: true, dark, kind }).then(answered, () =>
    answered(null),
  )
}
