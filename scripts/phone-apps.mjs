import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = join(fileURLToPath(new URL('..', import.meta.url)), 'apps', 'desktop')
const ROW = /"(\w+)" to Triple\("([^"]+)", "([^"]+)", "([^"]+)"\)/g
function phoneApps() {
  const gradle = readFileSync(join(DESKTOP, 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts'), 'utf8')
  return [...gradle.matchAll(ROW)]
    .filter(([, app]) => app !== 'orden')
    .map(([, app, id, name, scheme]) => {
      const built = existsSync(join(DESKTOP, 'src-tauri', `tauri.${app}.conf.json`))
      const driven = built && existsSync(join(DESKTOP, 'test', 'e2e', `${app}-phone.py`))
      return { app, id, name, scheme, built, driven }
    })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, only = ''] = process.argv.slice(2)
  if (mode === '--table') {
    console.log(JSON.stringify(phoneApps()))
    process.exit(0)
  }
  if (mode !== '--built' && mode !== '--driven') {
    console.error('usage: node scripts/phone-apps.mjs (--table | (--built | --driven) [app])')
    process.exit(2)
  }
  const apps = phoneApps()
    .filter((one) => (mode === '--built' ? one.built : one.driven))
    .map((one) => one.app)
  const picked = only && only !== 'all' ? apps.filter((app) => app === only) : apps
  if (!picked.length) {
    console.error(`no phone app ${only} to ${mode === '--built' ? 'build' : 'drive'}; there are: ${apps.join(', ')}`)
    process.exit(1)
  }
  console.log(JSON.stringify(picked))
}
