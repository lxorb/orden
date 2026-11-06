import { readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const KINDS = ['.app.tar.gz', '-setup.exe', '.AppImage', '.msi', '.dmg', '.deb', '.rpm']

const [, , root, given] = process.argv
if (!root || !given) {
  console.error('usage: name-assets.mjs <artifacts-dir> <version>')
  process.exit(1)
}

const version = given.replace(/^v/, '')

function filesIn(dir) {
  const out = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesIn(path))
    else out.push(path)
  }

  return out
}

let renamed = 0

for (const dir of readdirSync(root)) {
  const full = join(root, dir)
  if (!statSync(full).isDirectory()) continue

  const label = `Nib-${version}-${dir.replace(/^nib-/, '')}`

  for (const path of filesIn(full)) {
    const name = path.split(/[\\/]/).pop()

    const bare = name.endsWith('.sig') ? name.slice(0, -'.sig'.length) : name
    const kind = KINDS.find((one) => bare.endsWith(one))
    if (!kind) continue

    const wanted = label + kind + (name === bare ? '' : '.sig')
    if (wanted === name) continue

    renameSync(path, join(path.slice(0, -name.length), wanted))
    console.error(`${name} -> ${wanted}`)
    renamed++
  }
}

if (!renamed) {
  console.error(`no bundles found under ${root} - has the artifact layout changed?`)
  process.exit(1)
}
