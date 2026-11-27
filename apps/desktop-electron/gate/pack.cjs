const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const root = path.join(__dirname, '..')
const name = process.argv[2] || 'gate'
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
  const at = path.join(dir, entry.name)
  return sum + (entry.isSymbolicLink() ? 0 : entry.isDirectory() ? size(at) : fs.statSync(at).size)
}, 0)
async function main() {
  const { packager } = require('@electron/packager')
  const left = /^\/(pack|out|assets|machine\.json|.*\.zip)(\/|$)/
  const [dir] = await packager({ dir: root, name: 'OrdenElectronGate', out: path.join(root, 'pack'), overwrite: true, asar: true, ignore: (file) => left.test(file.replace(/\\/g, '/')) })
  const zip = path.join(root, `${name}.zip`)
  fs.rmSync(zip, { force: true })
  if (process.platform === 'win32') execFileSync('7z', ['a', '-tzip', '-mx=9', zip, '.'], { cwd: dir, stdio: 'ignore' })
  else execFileSync('zip', ['-qry9', zip, '.'], { cwd: dir })
  const body = { check: 'size', unpackedMB: +(size(dir) / 2 ** 20).toFixed(1), zipMB: +(fs.statSync(zip).size / 2 ** 20).toFixed(1), release: 'v0.22.5 installers: Windows x64 setup 138.9 MB, Windows arm64 setup 127.8 MB, macOS arm64 dmg 154.7 MB, Linux x64 AppImage 205.8 MB, deb 154 MB' }
  fs.mkdirSync(path.join(root, 'out'), { recursive: true })
  fs.writeFileSync(path.join(root, 'out', 'size.json'), JSON.stringify(body))
  console.log(JSON.stringify(body))
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
