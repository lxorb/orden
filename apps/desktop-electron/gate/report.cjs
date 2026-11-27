const fs = require('fs')
const path = require('path')
const dir = process.argv[2]
const file = path.join(dir, 'results.json')
if (!fs.existsSync(file)) {
  console.log('no results.json')
  process.exit(0)
}
const all = JSON.parse(fs.readFileSync(file, 'utf8'))
const first = all[0] || {}
console.log(`### Electron gate: ${first.platform} ${first.arch}, Electron ${first.electron}, Chromium ${first.chrome}`)
console.log(`GPU: ${JSON.stringify(first.gpu)}`)
for (const name of ['machine.json', 'size.json']) if (fs.existsSync(path.join(dir, name))) console.log(`${name}: ${fs.readFileSync(path.join(dir, name), 'utf8').trim()}`)
console.log('')
console.log('| Check | Arm | Round | Result | Data |')
console.log('|---|---|---|---|---|')
for (const b of all) console.log(`| ${b.check} | ${b.mode} | ${b.round} | ${b.pass ? 'pass' : 'FAIL'} | \`${JSON.stringify(b.data).replace(/\|/g, '/').slice(0, 900)}\` ${(b.notes || []).join('; ')} |`)
