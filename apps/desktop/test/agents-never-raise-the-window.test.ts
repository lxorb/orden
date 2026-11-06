import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../src-tauri/src/${path}`, import.meta.url)), 'utf8')

function launchers(text: string): string[] {
  return text.split(/\nfn launch\(\) -> Result<\(\), String> \{/).slice(1)
}

describe('an agent connecting and the reader’s window', () => {
  test('nib mcp starts the app asking for no window, on every desktop', () => {
    const app = read('mcp/app.rs')
    const each = launchers(app)
    expect(each.length).toBe(3)
    for (const one of each) {
      const body = one.slice(0, one.indexOf('\n}\n'))
      const detached = body.includes('detached(')
      expect(detached || body.includes('BACKGROUND_FLAG'), body).toBe(true)
    }
    const detached = app.slice(app.indexOf('fn detached('))
    expect(detached.slice(0, detached.indexOf('\n}\n'))).toContain('BACKGROUND_FLAG')
  })

  test('a first launch so asked builds its window off the screen', () => {
    expect(read('lib.rs')).toMatch(
      /else if uris::launched_quietly\(handle\) \{[\s\S]{0,300}building\.visible\(false\)\.build\(\)/,
    )
    const quietly = read('uris.rs')
    const body = quietly.slice(quietly.indexOf('pub fn launched_quietly('))
    expect(body.slice(0, body.indexOf('\n}\n'))).toMatch(
      /if crate::launch::in_background\(&std::env::args_os\(\)\.collect::<Vec<_>>\(\)\) \{\s*return true;/,
    )
  })

  test('a second launch so asked is answered by nothing, before anything is shown', () => {
    const launch = read('launch.rs')
    const second = launch.slice(launch.indexOf('fn second_launch(app: &AppHandle'))
    const quiet = second.indexOf('if in_background(argv) {\n        return;\n    }')
    expect(quiet).toBeGreaterThan(0)
    expect(quiet).toBeLessThan(second.indexOf('window.show()'))
    expect(quiet).toBeLessThan(second.indexOf('bring_forward('))
  })
})
