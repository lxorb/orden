import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const LAYERS = { foundation: 0, shell: 1, content: 2, features: 3, native: 0 }

const SKIPPED = new Set(['node_modules', 'dist', 'target', '.git', 'graphify-out', 'shots'])

const MODULE_ROOTS = [
  'packages',
  'services',
  'apps/desktop/src/lib',
  'apps/desktop/src-tauri/crates',
]

const CONTRACT_TESTS = {
  ts: ['test/contract.test.ts', 'contract.test.ts', 'src/contract.test.ts'],
  rust: ['tests/contract.rs'],
}

const NAME = /^[a-z][a-z0-9-]*$/

const keyOf = (module) => `${module.lang}:${module.name}`

function walk(dir, found) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else if (entry.name === 'module.json') found.push(path)
  }
  return found
}

export function findModules(root = ROOT) {
  const files = []
  for (const under of MODULE_ROOTS) {
    const dir = join(root, under)
    if (existsSync(dir)) walk(dir, files)
  }
  return files.sort().map((file) => {
    const dir = dirname(file)
    let json = {}
    let broken = null
    try {
      json = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      broken = error instanceof Error ? error.message : String(error)
    }
    const lang = json.lang ?? 'ts'
    return {
      file: relative(root, file).split(sep).join('/'),
      dir: relative(root, dir).split(sep).join('/'),
      absolute: dir,
      name: json.name,
      layer: json.layer,
      lang,
      api: json.api ?? (lang === 'rust' ? 'src/lib.rs' : 'src/api.ts'),
      dependsOn: Array.isArray(json.dependsOn) ? json.dependsOn : [],
      pending: Array.isArray(json.pending) ? json.pending : [],
      host: enclosingPackage(dir, root),
      json,
      broken,
    }
  })
}

function enclosingPackage(dir, root) {
  for (let at = dir; at.startsWith(root); at = dirname(at)) {
    const manifest = join(at, 'package.json')
    if (at !== root && existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
        return {
          name: typeof parsed.name === 'string' ? parsed.name : null,
          dir: at,
          libraries: new Set([
            ...Object.keys(parsed.dependencies ?? {}),
            ...Object.keys(parsed.devDependencies ?? {}),
          ]),
        }
      } catch {
        return null
      }
    }
    if (at === root) break
  }
  return null
}

function workspacePackages(root) {
  const names = new Map()
  for (const under of ['packages', 'services', 'apps']) {
    const dir = join(root, under)
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = join(dir, entry.name, 'package.json')
      if (!existsSync(manifest)) continue
      try {
        const { name } = JSON.parse(readFileSync(manifest, 'utf8'))
        if (typeof name === 'string') names.set(entry.name, { name, dir: `${under}/${entry.name}` })
      } catch {
        continue
      }
    }
  }
  return names
}

function contractTestOf(module) {
  return CONTRACT_TESTS[module.lang].find((one) => existsSync(join(module.absolute, one))) ?? null
}

const IMPORTS =
  /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

function importsOf(text) {
  const specifiers = []
  for (const match of text.matchAll(IMPORTS)) specifiers.push(match[1] ?? match[2] ?? match[3])
  return specifiers
}

function standsAlone(module, test, problems) {
  if (module.lang !== 'ts') return
  const text = readFileSync(join(module.absolute, test), 'utf8')
  const own = module.packageName
  for (const specifier of importsOf(text)) {
    if (specifier === 'vitest' || specifier.startsWith('node:')) continue
    if (specifier.startsWith('.')) {
      const target = resolve(join(module.absolute, dirname(test)), specifier)
      if (!target.startsWith(module.absolute + sep)) {
        problems.push(`${module.dir}/${test}: reaches outside the module with '${specifier}'`)
      }
      continue
    }
    if (specifier === own || specifier === '@orden/contracts') continue
    const library = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0]
    if (!specifier.startsWith('@orden/') && module.host?.libraries.has(library)) continue
    const fake = /^@orden\/([a-z0-9-]+)\/(?:sim|fakes)$/.exec(specifier)
    if (fake && module.dependsOn.includes(fake[1])) continue
    if (specifier.startsWith('@orden/')) {
      problems.push(
        `${module.dir}/${test}: a contract test runs without other modules, but imports '${specifier}' (fake its dependency instead)`,
      )
      continue
    }
    problems.push(
      `${module.dir}/${test}: imports '${specifier}'; a contract test takes vitest, node and its own module only`,
    )
  }
}

export function check(root = ROOT) {
  const modules = findModules(root)
  const problems = []
  const byName = new Map()
  const packages = workspacePackages(root)
  for (const module of modules) {
    if (module.broken) {
      problems.push(`${module.file}: not valid JSON (${module.broken})`)
      continue
    }
    const { json } = module
    for (const key of Object.keys(json)) {
      if (!['name', 'layer', 'lang', 'api', 'dependsOn', 'pending'].includes(key)) {
        problems.push(`${module.file}: unknown field '${key}'`)
      }
    }
    if (typeof json.name !== 'string' || !NAME.test(json.name)) {
      problems.push(`${module.file}: 'name' must match ${NAME}`)
      continue
    }
    if (!(json.layer in LAYERS))
      problems.push(`${module.file}: 'layer' must be one of ${Object.keys(LAYERS).join(', ')}`)
    if (json.lang !== undefined && !['ts', 'rust'].includes(json.lang))
      problems.push(`${module.file}: 'lang' must be ts or rust`)
    if (json.api !== undefined && (typeof json.api !== 'string' || !json.api.startsWith('src/'))) {
      problems.push(`${module.file}: 'api' must name a file under src/`)
    }
    if (
      !Array.isArray(json.dependsOn) ||
      json.dependsOn.some((one) => typeof one !== 'string' || !NAME.test(one))
    ) {
      problems.push(`${module.file}: 'dependsOn' must be a list of module names`)
    } else if (new Set(json.dependsOn).size !== json.dependsOn.length) {
      problems.push(`${module.file}: 'dependsOn' names a module twice`)
    }
    if (json.pending !== undefined) {
      if (!Array.isArray(json.pending) || json.pending.some((one) => typeof one !== 'string')) {
        problems.push(`${module.file}: 'pending' must be a list of repo paths not yet extracted`)
      } else {
        for (const path of json.pending) {
          if (!existsSync(join(root, path)))
            problems.push(`${module.file}: pending path '${path}' does not exist; drop it`)
        }
      }
    }
    const folder = module.dir.split('/').at(-1)
    if (folder !== json.name)
      problems.push(`${module.file}: module '${json.name}' lives in a folder named '${folder}'`)
    if (byName.has(keyOf(module)))
      problems.push(`${module.file}: module '${json.name}' is declared twice`)
    const manifest = join(module.absolute, 'package.json')
    let packageName = null
    if (module.lang === 'ts' && existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
        packageName = parsed.name ?? null
        const main = parsed.exports?.['.'] ?? parsed.exports
        if (typeof main !== 'string' || main.replace(/^\.\//, '') !== module.api) {
          problems.push(
            `${module.dir}/package.json: exports['.'] must be ./${module.api}, the module's api`,
          )
        }
      } catch {
        problems.push(`${module.dir}/package.json: not valid JSON`)
      }
    }
    if (module.lang === 'rust' && !existsSync(join(module.absolute, 'Cargo.toml'))) {
      problems.push(`${module.dir}: a Rust module is one crate, with its own Cargo.toml`)
    }
    if (!existsSync(join(module.absolute, module.api)))
      problems.push(`${module.dir}: missing its api, ${module.api}`)
    const test = contractTestOf(module)
    if (!test)
      problems.push(
        `${module.dir}: missing its contract test (${CONTRACT_TESTS[module.lang].join(' or ')})`,
      )
    byName.set(keyOf(module), { ...module, packageName, test })
  }
  for (const module of byName.values()) {
    if (module.name === 'contracts' && module.dependsOn.length > 0)
      problems.push(`${module.file}: contracts depends on nothing`)
    for (const dep of module.dependsOn) {
      if (dep === module.name) problems.push(`${module.file}: depends on itself`)
      const target = byName.get(`${module.lang}:${dep}`) ?? byName.get(`ts:${dep}`)
      if (!target) {
        if (!packages.has(dep))
          problems.push(
            `${module.file}: depends on '${dep}', which is neither a module nor a workspace package`,
          )
        continue
      }
      if (LAYERS[target.layer] > LAYERS[module.layer]) {
        problems.push(
          `${module.file}: a ${module.layer} module may not depend on '${dep}' (${target.layer})`,
        )
      }
      if (module.layer === 'features' && target.layer === 'features') {
        problems.push(
          `${module.file}: features never depend on each other ('${dep}'); go through contracts`,
        )
      }
      if (module.lang !== target.lang && dep !== 'contracts') {
        problems.push(
          `${module.file}: '${dep}' is a ${target.lang} module; the two sides meet only in contracts`,
        )
      }
    }
    if (module.test) standsAlone(module, module.test, problems)
    for (const path of module.pending) {
      const inside = moduleOf(join(root, path), [...byName.values()])
      if (inside && inside !== module) {
        problems.push(
          `${module.file}: pending path '${path}' is inside module '${inside.name}'; import its api and declare the dependency instead`,
        )
      }
    }
  }
  const state = new Map()
  const trail = []
  const visit = (name) => {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'open') {
      problems.push(`dependency cycle: ${[...trail.slice(trail.indexOf(name)), name].join(' -> ')}`)
      return
    }
    state.set(name, 'open')
    trail.push(name)
    const module = byName.get(name)
    for (const dep of module?.dependsOn ?? []) {
      const key = byName.has(`${module.lang}:${dep}`) ? `${module.lang}:${dep}` : `ts:${dep}`
      if (byName.has(key)) visit(key)
    }
    trail.pop()
    state.set(name, 'done')
  }
  for (const key of byName.keys()) visit(key)
  return { modules: [...byName.values()], problems: [...new Set(problems)] }
}

export function moduleOf(file, modules) {
  const path = resolve(file)
  let found = null
  for (const module of modules) {
    if (path === module.absolute || path.startsWith(module.absolute + sep)) {
      if (!found || module.absolute.length > found.absolute.length) found = module
    }
  }
  return found
}

function runContracts(root) {
  const { modules, problems } = check(root)
  if (problems.length > 0) return 1
  let failed = 0
  for (const module of modules) {
    if (!module.test) continue
    const command =
      module.lang === 'rust'
        ? [
            'cargo',
            ['test', '--manifest-path', join(module.dir, 'Cargo.toml'), '--test', 'contract'],
          ]
        : [
            'pnpm',
            [
              '--filter',
              module.packageName ?? module.host?.name ?? module.name,
              'exec',
              'vitest',
              'run',
              relative(module.host?.dir ?? module.absolute, join(module.absolute, module.test)),
            ],
          ]
    console.log(`\n== ${module.name}: ${module.dir}/${module.test}`)
    const ran = spawnSync(command[0], command[1], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (ran.status !== 0) failed += 1
  }
  return failed === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? '--check'
  if (mode === '--list') {
    for (const module of check().modules) {
      console.log(
        `${module.name.padEnd(20)} ${module.layer.padEnd(11)} ${module.lang.padEnd(5)} ${module.dir}  deps: ${module.dependsOn.join(', ') || 'none'}`,
      )
    }
  } else if (mode === '--contracts') {
    process.exitCode = runContracts(ROOT)
  } else if (mode === '--check') {
    const { modules, problems } = check()
    for (const problem of problems) console.error(`modules: ${problem}`)
    if (problems.length > 0) process.exitCode = 1
    else console.log(`modules: ${modules.length} module${modules.length === 1 ? '' : 's'} in order`)
  } else {
    console.error('usage: node scripts/modules.mjs [--check | --list | --contracts]')
    process.exitCode = 2
  }
}
