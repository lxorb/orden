import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What the packaging says about the bytes it ships.
 *
 *  Every path under `packaging/` takes the release's own files and hands them to
 *  somebody's package manager, so each of them is a place where "the bytes this
 *  release made" has to be more than a URL: a tampered asset, or a proxy on the
 *  runner that builds the package, otherwise goes out under the product's name.
 *
 *  Read off the files rather than written down here. What the digest *is* cannot be
 *  checked without the network; that is the `deb` job in
 *  `.github/workflows/validate-linux-packaging.yml`, which downloads both files and
 *  compares. What is checked here is that there is one at all, that it is the shape
 *  a digest is, and that it belongs to the version beside it. */

const HERE = fileURLToPath(new URL('../../..', import.meta.url))
const ROOT = join(HERE, 'packaging')
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8')
const repo = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')

describe('the snap', () => {
  const snap = read('snap', 'snapcraft.yaml')

  /** It unpacks the release `.deb` rather than rebuilding the app, so the `.deb` is
   *  what it has to be sure of. This was the one packaging path with no digest at
   *  all: scoop, chocolatey and homebrew pin a sha256, the AUR pins one in its
   *  `.SRCINFO`, nix pins a hash, and Flathub pins a commit. */
  test('pins the bytes of the .deb it unpacks, per architecture', () => {
    const held = [...snap.matchAll(/on (amd64|arm64): sha256\/([0-9a-f]+)/g)]

    expect(held.map((one) => one[1])).toEqual(['amd64', 'arm64'])
    for (const [, arch, digest] of held) expect(digest, arch).toHaveLength(64)
  })

  /** snapcraft takes no `on <arch>:` list for the checksum, though it does for the source
   *  (snapcraft 8.11.1: "Input should be a valid string"); the list kept every snap from
   *  building. One line, then, which the workflow sets per architecture and which holds
   *  amd64's as committed. */
  test("checks the .deb with one line snapcraft reads, amd64's as committed", () => {
    const line = /^ *source-checksum: (.*)$/m.exec(snap)?.[1]
    const amd64 = /on amd64: (sha256\/[0-9a-f]{64})/.exec(snap)?.[1]
    expect(line).toBe(amd64)
    expect(snap).not.toMatch(/source-checksum:\s*\n\s*-/)
  })

  test('and names the same version in the URL as it publishes', () => {
    const version = /^version: '([^']+)'$/m.exec(snap)?.[1]
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)

    const urls = [...snap.matchAll(/releases\/download\/v([^/]+)\/(?:Nib|Orden)-([^-]+)-linux-/g)]
    expect(urls).toHaveLength(2)
    for (const [, tag, named] of urls) {
      expect(tag).toBe(version)
      expect(named).toBe(version)
    }
  })
})

/** The two digests and the version are rewritten per release rather than by hand;
 *  see packaging/linux.md. A step that rewrote the URL and left the digest behind
 *  would fail the build, which is the right failure - but it would fail every
 *  release, so the sed that keeps them together is worth holding to. */
describe('the workflow that publishes it', () => {
  const workflow = readFileSync(
    join(fileURLToPath(new URL('../../..', import.meta.url)), '.github/workflows/snap.yml'),
    'utf8',
  )

  test('rewrites the digests beside the version and the URL', () => {
    expect(workflow).toContain('on amd64: sha256/$amd64')
    expect(workflow).toContain('on arm64: sha256/$arm64')
  })

  test('and refuses to build a snap when the release reports no digest', () => {
    expect(workflow).toContain('reports no sha256 for a linux .deb')
    expect(workflow).toContain('exit 1')
  })
})

/** Only `unstable`, which `edge` is built from, and a tag have a release to go on.
 *  scripts/build-version.sh names every other ref `edge` as well, because "not a tag"
 *  is all it asks - so a manual run of release.yml on a branch, which is somebody
 *  checking that the builds work, would
 *  otherwise delete the signed `edge` and put that branch's build in its place, and
 *  every install on the unstable channel (src-tauri/src/updates.rs) would update to
 *  it. The builds still run on a branch; the job that writes does not. */
describe('the release', () => {
  const workflow = repo('.github', 'workflows', 'release.yml')
  const publishJob = () =>
    /\n {2}publish:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n|$)/.exec(workflow)?.[1] ?? ''
  const stepRun = (name: string) => {
    const step = new RegExp(`- name: ${name}\\n([\\s\\S]*?)(?=\\n {6}- |$)`).exec(publishJob())?.[1]
    const block = /run: \|\n([\s\S]*)/.exec(step ?? '')?.[1] ?? ''
    return block.replace(/^ {10}/gm, '')
  }

  function upload(gh: { refuse?: string; drop?: string }) {
    const at = mkdtempSync(join(tmpdir(), 'nib-release-'))
    mkdirSync(join(at, 'bin'))
    mkdirSync(join(at, 'artifacts'))
    const bundles = [
      'Nib-1.0.0-linux-x64.AppImage',
      'Nib-1.0.0-windows-x64-setup.exe',
      'Nib-1.0.0-linux-x64.rpm',
    ]
    for (const name of bundles) writeFileSync(join(at, 'artifacts', name), 'bytes')
    writeFileSync(
      join(at, 'latest.json'),
      JSON.stringify({
        platforms: Object.fromEntries(
          bundles.map((name) => [
            name,
            { url: `https://github.com/o/r/releases/download/t/${name}` },
          ]),
        ),
      }),
    )
    const log = join(at, 'gh.log')
    const held = join(at, 'held')
    writeFileSync(held, '')
    writeFileSync(
      join(at, 'bin', 'gh'),
      `#!/bin/bash
echo "$*" >> "${log}"
case "$1 $2" in
  "release upload")
    if [ -n "$REFUSE" ] && [[ "$*" == *"$REFUSE"* ]]; then exit 1; fi
    name=$(basename "$4")
    if [ -z "$DROP" ] || [ "$name" != "$DROP" ]; then echo "$name" >> "${held}"; fi
    ;;
  "release view") cat "${held}" ;;
esac
`,
    )
    chmodSync(join(at, 'bin', 'gh'), 0o755)
    const ran = spawnSync('bash', ['-e', '-c', stepRun('Upload the files')], {
      cwd: at,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(at, 'bin')}:${process.env.PATH ?? ''}`,
        TAG: 'v1.0.0',
        FILES: 'updates',
        REFUSE: gh.refuse ?? '',
        DROP: gh.drop ?? '',
      },
    })
    return { status: ran.status, calls: readFileSync(log, 'utf8'), said: ran.stdout + ran.stderr }
  }

  describe.skipIf(process.platform === 'win32')('uploads', () => {
    test('a refused installer stops the step, before the manifest that names it', () => {
      const { status, calls } = upload({ refuse: 'updates artifacts/Nib-1.0.0-linux-x64.AppImage' })
      expect(status).not.toBe(0)
      expect(calls).not.toContain('latest.json')
    })

    test('a manifest naming a file the release does not hold is not uploaded', () => {
      const { status, calls, said } = upload({ drop: 'Nib-1.0.0-windows-x64-setup.exe' })
      expect(status).not.toBe(0)
      expect(calls).not.toContain('latest.json')
      expect(said).toContain('Nib-1.0.0-windows-x64-setup.exe')
    })

    test('with everything up, the manifest goes last', () => {
      const { status, calls } = upload({})
      expect(status).toBe(0)
      expect(calls.trim().split('\n').at(-1)).toContain('latest.json')
    })
  })

  /** A `.deb` or an `.rpm` install is updated through PackageKit with its own package,
   *  checked against the updater's key like any bundle (#1147; src-tauri/src/system_update.rs). */
  test('names every Linux package in the manifest, by its architecture and kind', () => {
    const at = mkdtempSync(join(tmpdir(), 'nib-manifest-'))
    for (const [arch, kinds] of [
      ['x64', ['AppImage', 'deb', 'rpm']],
      ['arm64', ['AppImage', 'deb', 'rpm']],
    ] as const) {
      mkdirSync(join(at, `nib-linux-${arch}`))
      for (const kind of kinds) {
        writeFileSync(
          join(at, `nib-linux-${arch}`, `Nib-1.0.0-linux-${arch}.${kind}.sig`),
          `sig ${arch} ${kind}`,
        )
      }
    }
    const ran = spawnSync(
      'node',
      [join(HERE, 'scripts', 'update-manifest.mjs'), 'updates', '1.0.0', at],
      {
        encoding: 'utf8',
      },
    )
    expect(ran.status, ran.stderr).toBe(0)
    const platforms = (
      JSON.parse(ran.stdout) as { platforms: Record<string, { url: string; signature: string }> }
    ).platforms
    for (const [key, file, signature] of [
      ['linux-x86_64', 'Nib-1.0.0-linux-x64.AppImage', 'sig x64 AppImage'],
      ['linux-x86_64-deb', 'Nib-1.0.0-linux-x64.deb', 'sig x64 deb'],
      ['linux-x86_64-rpm', 'Nib-1.0.0-linux-x64.rpm', 'sig x64 rpm'],
      ['linux-aarch64-deb', 'Nib-1.0.0-linux-arm64.deb', 'sig arm64 deb'],
      ['linux-aarch64-rpm', 'Nib-1.0.0-linux-arm64.rpm', 'sig arm64 rpm'],
    ] as const) {
      expect(platforms[key]?.url, key).toBe(
        `https://github.com/lxorb/nibeditor/releases/download/updates/${file}`,
      )
      expect(platforms[key]?.signature, key).toBe(signature)
    }
  })

  describe.skipIf(process.platform === 'win32')(
    'puts on the release the app downloads from',
    () => {
      test('the .deb and the .rpm beside the setups', () => {
        const { status, calls } = upload({})
        expect(status).toBe(0)
        expect(calls).toContain(
          'release upload updates artifacts/Nib-1.0.0-linux-x64.rpm --clobber',
        )
      })
    },
  )

  test('uploads the signatures of the .deb and the .rpm the build made', () => {
    for (const kind of ['deb', 'rpm']) {
      expect(workflow).toContain(`release/bundle/${kind}/*.sig`)
    }
  })

  describe('a tag', () => {
    const job = (workflowText: string, name: string) =>
      new RegExp(`\\n {2}${name}:\\n([\\s\\S]*?)(?=\\n {2}[a-z-]+:\\n|$)`).exec(
        workflowText,
      )?.[1] ?? ''

    test('one job makes the draft, on a tag and before anything is built', () => {
      const draft = job(workflow, 'draft')
      expect(draft).toContain('--draft')
      expect(draft).toContain('gh release view "$TAG"')
      expect(draft).toContain("startsWith(github.ref, 'refs/tags/v')")
      expect(draft).toMatch(/needs: \[?version\]?/)
      expect(job(workflow, 'publish')).not.toContain('gh release create "$TAG"')
      expect(job(workflow, 'publish')).toMatch(/needs: \[.*draft.*\]/)
      expect(job(workflow, 'publish')).toContain("needs.draft.result != 'failure'")
    })

    test('is out only once its manifest is up, and handed on only after', () => {
      const steps = ['Upload the files', 'Publish the release', 'Hand the release']
      const places = steps.map((name) => publishJob().indexOf(`- name: ${name}`))
      expect(places.every((at) => at >= 0)).toBe(true)
      expect(places).toEqual([...places].sort((a, b) => a - b))
      expect(stepRun('Publish the release')).toContain('--draft=false')
    })

    test('the phones wait for the draft, and neither make nor publish it', () => {
      const mobile = repo('.github', 'workflows', 'publish-mobile.yml')
      const tagged = /- name: Wait for the draft\n([\s\S]*?)(?=\n {6}- )/.exec(mobile)?.[1] ?? ''
      expect(tagged).toContain('gh release view "$TAG"')
      expect(tagged).toContain('exit 1')
      expect(mobile.match(/gh release create/g)?.length).toBe(1)
      expect(mobile).toMatch(/gh release create "\$TAG" --prerelease/)
      expect(mobile).not.toContain('--draft')
    })

    function publish(tag: string, latest: string, draft: boolean) {
      const at = mkdtempSync(join(tmpdir(), 'nib-release-'))
      mkdirSync(join(at, 'bin'))
      const log = join(at, 'gh.log')
      writeFileSync(log, '')
      writeFileSync(
        join(at, 'bin', 'gh'),
        `#!/bin/bash
echo "$*" >> "${log}"
case "$*" in
  *isDraft*) echo ${draft} ;;
  *tagName*) ${latest ? `echo ${latest}` : 'echo "release not found" >&2; exit 1'} ;;
esac
`,
      )
      chmodSync(join(at, 'bin', 'gh'), 0o755)
      const ran = spawnSync('bash', ['-e', '-c', stepRun('Publish the release')], {
        cwd: at,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${join(at, 'bin')}:${process.env.PATH ?? ''}`, TAG: tag },
      })
      expect(ran.status, ran.stderr).toBe(0)
      return readFileSync(log, 'utf8')
        .split('\n')
        .filter((one) => one.startsWith('release edit'))
    }

    describe.skipIf(process.platform === 'win32')('when it comes out', () => {
      test('the newest version is the latest', () => {
        expect(publish('v0.21.0', 'v0.20.0', true)).toEqual([
          'release edit v0.21.0 --draft=false --latest',
        ])
        expect(publish('v0.10.0', 'v0.9.0', true)).toEqual([
          'release edit v0.10.0 --draft=false --latest',
        ])
      })

      test('an old tag run again does not take the latest back', () => {
        expect(publish('v0.19.1', 'v0.20.0', true)).toEqual([
          'release edit v0.19.1 --draft=false --latest=false',
        ])
      })

      test('the first release there is, is the latest', () => {
        expect(publish('v1.0.0', '', true)).toEqual(['release edit v1.0.0 --draft=false --latest'])
      })

      test('one already out is left as it is', () => {
        expect(publish('v0.21.0', 'v0.21.0', false)).toEqual([])
      })
    })
  })

  test('publishes only from unstable or a tag', () => {
    const job = /\n {2}publish:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n|$)/.exec(workflow)?.[1] ?? ''
    const guard = /^ {4}if: (.*)$/m.exec(job)?.[1] ?? ''

    expect(guard).toContain("github.ref == 'refs/heads/unstable'")
    expect(guard).not.toContain("github.ref == 'refs/heads/main'")
    expect(guard).toContain("startsWith(github.ref, 'refs/tags/v')")
  })

  // #491: edge was titled `main` and every file on it kept the updater's `Nib-`. Only
  // the bundles latest.json names keep it now, for the builds before 0.14.
  test('titles edge by its branch and names its installers Orden', () => {
    const job = /\n {2}publish:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n|$)/.exec(workflow)?.[1] ?? ''
    const upload = /- name: Upload the files\n([\s\S]*?)(?=\n {6}- )/.exec(job)?.[1] ?? ''

    expect(job).not.toContain('main ·')
    expect(job).toContain('--title "$GITHUB_REF_NAME · $VERSION"')
    expect(upload).not.toContain('ROLLING')
    expect(upload).toContain('cp "$file" "installers/Orden-${name#Nib-}"')
  })

  test('and no other job writes', () => {
    const writing = [...workflow.matchAll(/\n {2}([a-z-]+):\n[\s\S]*?(?=\n {2}[a-z-]+:\n|$)/g)]
      .filter((one) => /contents: write|gh release/.test(one[0]))
      .map((one) => one[1])

    // The draft a tag's run makes first runs nothing out of the repository, so what it may
    // write is out of reach of anything a build fetched. nix-edge (#1135) runs only the
    // repository's own script, over the digests the release page reports, and takes
    // nothing a build made.
    expect(writing).toEqual(['draft', 'publish', 'nix-edge'])
    expect(/\n {2}draft:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n)/.exec(workflow)?.[1]).not.toContain(
      'uses:',
    )
    expect(/\n {2}nix-edge:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n)/.exec(workflow)?.[1]).not.toContain(
      'download-artifact',
    )
  })
})

/** The supply the release is built out of: the tools a workflow runs, the pins that
 *  keep them still, and who has to have read a change to any of it.
 *
 *  A release is signed on a runner, out of whatever that runner fetched. Every pin in
 *  this repository is there because "the version we asked for" and "the bytes we ran"
 *  are two different things - and a pin nobody updates is its own problem, which is
 *  what the schedule is for. */
describe('what a workflow is allowed to fetch', () => {
  const folder = join(HERE, '.github', 'workflows')
  const workflows = readdirSync(folder).filter((name) => name.endsWith('.yml'))

  /** `npx --yes some-tool@1.2.3` names a version and runs whatever the registry
   *  answers with at that moment. A devDependency is a hash in pnpm-lock.yaml, and
   *  `pnpm install --frozen-lockfile` has already refused anything that is not it - so
   *  a tool that decides what goes into a package comes from there. The packer for the
   *  glasses plugin was the last one that did not; see `even:pack`. */
  test('is nothing it fetches while it runs', () => {
    const fetching: string[] = []

    for (const name of workflows) {
      const held = readFileSync(join(folder, name), 'utf8')
      for (const line of held.split(/\r?\n/)) {
        // Comments are prose about this very rule in at least one of them.
        if (/^\s*#/.test(line)) continue
        if (/\b(?:npx|pnpm dlx|npm exec|yarn dlx|uvx|pipx run)\b/.test(line)) {
          fetching.push(`${name}: ${line.trim()}`)
        }
      }
    }

    expect(fetching).toEqual([])
  })

  test('and a change to any of it has to have been read', () => {
    const owners = repo('.github', 'CODEOWNERS')

    for (const path of [
      '/.github/workflows/**',
      '/packaging/**',
      '/apps/desktop/src-tauri/tauri.conf.json',
      '/pnpm-lock.yaml',
    ]) {
      expect(owners, path).toContain(`${path} @`)
    }
  })
})

/** nib opens no note from outside its spaces, so no bundle and no package manager
 *  offers it a note: no double click, no "Open with", no share of a file to open
 *  where it lies. Held here rather than trusted to memory, because a file type is
 *  one line of config away on every platform and each one quietly makes Orden a file
 *  opener again. The web's two schemes are the browser's, and stay. And a PDF, which
 *  every bundle offers nib for in "Open with" and none makes nib the default of; it
 *  is brought into a space before it is read (src-tauri/src/handed_pdfs.rs). */
describe('what nib claims to open', () => {
  const tauri = (...parts: string[]) => repo('apps', 'desktop', 'src-tauri', ...parts)

  test('no file type in any bundle but a PDF, and that one only offered', () => {
    // Tauri's own Windows installer makes an association the default.
    for (const config of ['tauri.conf.json', 'tauri.macos.conf.json']) {
      expect(tauri(config), config).not.toContain('fileAssociations')
    }
    expect(tauri('Info.ios.plist')).not.toContain('CFBundleDocumentTypes')
    for (const plist of ['Info.plist', 'Info.ios.plist']) {
      expect(tauri(plist), plist).not.toContain('UTImportedTypeDeclarations')
    }
    const types = /<key>CFBundleDocumentTypes<\/key>[\s\S]*?\n\t<\/array>/.exec(tauri('Info.plist'))
    expect(types?.[0].match(/<string>[^<]*<\/string>/g)).toEqual([
      '<string>PDF document</string>',
      '<string>Viewer</string>',
      '<string>Alternate</string>',
      '<string>com.adobe.pdf</string>',
    ])

    const linux = JSON.parse(tauri('tauri.linux.conf.json')) as {
      bundle: { fileAssociations: { ext: string[]; mimeType: string; rank: string }[] }
    }
    expect(linux.bundle.fileAssociations).toMatchObject([
      { ext: ['pdf'], mimeType: 'application/pdf', rank: 'Alternate' },
    ])

    expect(tauri('wix', 'browser.wxs')).not.toMatch(/<(ProgId|Extension)\b/)
    expect(tauri('wix', 'pdf.wxs')).not.toMatch(/<(ProgId|Extension)\b/)
    expect(tauri('wix', 'pdf.wxs')).not.toContain(String.raw`Key="Software\Classes\.pdf" `)
  })

  /** The installer writes the browser and no file type, and an install over an
   *  older Orden - the updater's included, which never runs the old uninstaller -
   *  takes the older one's file types away. */
  test('an install claims no file type and forgets the ones it used to', () => {
    const script = tauri('installer.nsh')
    const [, install = '', uninstall = ''] = script.split(
      /!macro NSIS_HOOK_POSTINSTALL|!macro NSIS_HOOK_POSTUNINSTALL/,
    )

    const writes = script.split('\n').filter((line) => line.trim().startsWith('WriteRegStr'))
    expect(writes.length).toBeGreaterThan(0)
    for (const line of writes) {
      expect(line).not.toMatch(/Nib\.markdown|FileAssociations|Classes\\\.m/)
    }
    expect(install).toContain('!insertmacro NIB_FORGET_FILES')
    expect(uninstall).toContain('!insertmacro NIB_FORGET_FILES')
    for (const ext of ['md', 'markdown', 'mdown', 'mkd']) {
      expect(script).toContain(`!insertmacro NIB_FORGET_EXTENSION "${ext}"`)
    }
    expect(script).toContain(String.raw`DeleteRegKey SHCTX "Software\Classes\Nib.markdown"`)
  })

  const desktops = {
    'aur/nib-bin/nib.desktop': read('aur', 'nib-bin', 'nib.desktop'),
    'flathub/so.orden.Orden.desktop': read('flathub', 'so.orden.Orden.desktop'),
    'nix/orden.desktop': read('nix', 'orden.desktop'),
    'snap/snapcraft.yaml': read('snap', 'snapcraft.yaml'),
  }

  test('a Linux desktop entry is a browser and a reader of PDFs, no editor of files', () => {
    for (const [name, entry] of Object.entries(desktops)) {
      expect(entry, name).toContain(
        'MimeType=x-scheme-handler/http;x-scheme-handler/https;application/pdf;\n',
      )
      // The program is nib everywhere but Nix, whose package is called orden.
      expect(entry, name).toMatch(/^\s*Exec=(?:nib|orden) %U$/m)
      expect(entry, name).not.toContain('text/markdown')
      expect(entry, name).not.toContain('%F')
    }
  })

  /** The AUR fetches the desktop entry beside the PKGBUILD and checks it against the
   *  digest written there, so a change to the entry is a change to that digest. */
  test('and the AUR holds the digest of the entry it ships', () => {
    const digest = createHash('sha256').update(desktops['aur/nib-bin/nib.desktop']).digest('hex')

    expect(read('aur', 'nib-bin', 'PKGBUILD')).toContain(`sha256sums=('${digest}')`)
    expect(read('aur', 'nib-bin', '.SRCINFO')).toContain(`sha256sums = ${digest}`)
  })

  test('no package manager lists a file type', () => {
    for (const version of readdirSync(join(ROOT, 'winget'))) {
      const manifest = read('winget', version, 'lxorb.Nib.installer.yaml')
      expect(manifest, version).not.toContain('FileExtensions')
    }
    expect(read('chocolatey', 'orden.nuspec')).not.toMatch(/file association/i)
  })
})

/** The package managers' names up to 0.15.0, kept as roads to the new ones. Chocolatey
 *  has a way to deprecate a package and Scoop a folder for it; what each asks for is
 *  held here, because a mistake in either is found by everybody who installed the old
 *  name, and only on their next upgrade. See packaging/windows.md. */
describe('the old names', () => {
  const orden = read('chocolatey', 'orden.nuspec')
  const nib = read('chocolatey', 'nib.nuspec')
  const versionOf = (nuspec: string) => /<version>([^<]+)<\/version>/.exec(nuspec)?.[1]

  test('orden is the package Orden is in', () => {
    expect(orden).toContain('<id>orden</id>')
    expect(orden).toContain('<file src="tools\\**" target="tools" />')
  })

  test('nib is deprecated the way Chocolatey asks: a title, a dependency, no files, no icon', () => {
    expect(nib).toContain('<id>nib</id>')
    expect(nib).toMatch(/<title>\[Deprecated\] /)
    expect(nib).toContain('<files />')
    expect(nib).not.toContain('<iconUrl>')
    expect(nib).toContain(`<dependency id="orden" version="${versionOf(orden)}" />`)
  })

  test('and its version is the release the two were bumped to', () => {
    expect(versionOf(nib)).toBe(versionOf(orden))
  })

  test("Scoop's orden takes over what nib kept, once", () => {
    const scoop = JSON.parse(read('scoop', 'orden.json')) as { installer: { script: string[] } }
    expect(scoop.installer.script.join('\n')).toContain("Join-Path (Split-Path $persist_dir) 'nib'")
  })

  test('and removes the junction as a link alone, on install and on uninstall', () => {
    const scoop = JSON.parse(read('scoop', 'orden.json')) as {
      installer: { script: string[] }
      uninstaller: { script: string[] }
    }
    const uninstall = scoop.uninstaller.script.join('\n')
    expect(uninstall).toContain("$appdata.LinkType -eq 'Junction') { $appdata.Delete() }")
    // `-Recurse` only for a folder that is not a junction, never on one.
    expect(uninstall).not.toMatch(/Remove-Item "\$env:APPDATA[^"]*" [^\n]*-Recurse/)
    const install = scoop.installer.script.join('\n')
    expect(install).toContain("if ($item.LinkType -eq 'Junction') {\n        # The link alone")
    expect(install).toContain('$item.Delete()')
  })

  test("Scoop's nib is orden's without the five lines that take over from nib", () => {
    const scoop = JSON.parse(read('scoop', 'orden.json')) as { installer: { script: string[] } }
    const lines = scoop.installer.script
    const at = lines.findIndex((one) => one.startsWith('# Up to 0.15.0'))
    expect(at).toBeGreaterThan(-1)
    // The five lines publish.yml cuts: the comment, where Orden kept it, and the move.
    expect(lines.slice(at, at + 5)).toEqual([
      expect.stringMatching(/^# Up to 0\.15\.0/),
      "$was = Join-Path (Split-Path $persist_dir) 'nib'",
      expect.stringMatching(/^if \(\(Test-Path \$was\)/),
      expect.stringMatching(/^ {4}Get-ChildItem -LiteralPath \$was/),
      '}',
    ])
    const nib = [...lines.slice(0, at), ...lines.slice(at + 5)].join('\n')
    expect(nib).not.toContain('$was')
    expect(nib).toContain('New-Item -Path $appdata -ItemType Junction')
  })
})

/** Whether Scoop and Chocolatey move from `nib` to `orden` is the repository variable
 *  PACKAGE_RENAME, off until the rename has been tried on Windows; see
 *  packaging/windows.md, "Held back, and why". */
describe('the rename, held back', () => {
  const publish = repo('.github', 'workflows', 'publish.yml')
  const job = (name: string) =>
    new RegExp(`\n {2}${name}:\n([\\s\\S]*?)(?=\n {2}[a-z-]+:\n|$)`).exec(publish)?.[1] ?? ''

  test('is on only when the variable says true', () => {
    expect(job('gate')).toContain('PACKAGE_RENAME: ${{ vars.PACKAGE_RENAME }}')
    expect(job('gate')).toContain('if [[ "$PACKAGE_RENAME" == true ]]; then')
    for (const name of ['scoop', 'chocolatey']) {
      expect(job(name)).toContain('RENAME: ${{ needs.gate.outputs.rename }}')
    }
  })

  test('Scoop bumps nib where it is, and deprecates it only with the rename', () => {
    const scoop = job('scoop')
    expect(scoop).toContain('mv nib.json bucket/nib.json')
    expect(scoop).toContain('> bucket/deprecated/nib.json')
    expect(scoop).toContain('First scoop update nib, then scoop uninstall nib')
    expect(scoop).not.toContain('git mv bucket/nib.json')
  })

  test('Chocolatey pushes nib alone, as Orden, without the rename', () => {
    const chocolatey = job('chocolatey')
    expect(chocolatey).toContain('echo "PACKAGES=nib:$VERSION" >> "$GITHUB_ENV"')
    expect(chocolatey).toContain(
      'echo "PACKAGES=orden:$VERSION nib:$VERSION.$day" >> "$GITHUB_ENV"',
    )
    expect(chocolatey).toMatch(/409 \\\(Conflict\\\)/)
    // The paragraph the plain `nib` leaves out is there to be left out.
    expect(read('chocolatey', 'orden.nuspec')).toMatch(
      /\nThis package was called `nib` until 0\.15\.0\. `nib` is now an empty package that depends on\n[^\n]+\n\n/,
    )
  })
})

/** The apt repository, lxorb/apt: one key, said the same everywhere it is said, and both
 *  suites written by the one workflow. See packaging/linux.md, "apt". */
describe('the apt repository', () => {
  const workflow = repo('.github', 'workflows', 'apt.yml')
  const fingerprint = /APT_KEY_FINGERPRINT: ([0-9A-F]{40})/.exec(workflow)?.[1] ?? ''

  test('signs with the key whose fingerprint the page and the docs give', () => {
    expect(fingerprint).toHaveLength(40)
    const spaced = (fingerprint.match(/.{4}/g) ?? []).join(' ')
    expect(read('apt', 'README.md')).toContain(spaced)
    expect(read('apt', 'index.html')).toContain(spaced)
    expect(read('linux.md')).toContain(fingerprint)
    expect(read('apt', 'orden-archive-keyring.asc')).toMatch(
      /^-----BEGIN PGP PUBLIC KEY BLOCK-----/,
    )
  })

  /** Called, not dispatched: a dispatch finds only a workflow already on the default
   *  branch, and apt.yml is written on `unstable` first. */
  test('is written for stable by publish.yml and for unstable by release.yml', () => {
    const publish = repo('.github', 'workflows', 'publish.yml')
    const release = repo('.github', 'workflows', 'release.yml')
    for (const [caller, suite] of [
      [publish, 'stable'],
      [release, 'unstable'],
    ] as const) {
      expect(caller).toMatch(
        new RegExp(String.raw`uses: \./\.github/workflows/apt\.yml
\s+with:
\s+suite: ${suite}
`),
      )
      expect(caller).not.toContain('gh workflow run apt.yml')
    }
    expect(repo('.github', 'workflows', 'apt.yml')).toContain('workflow_call:')
  })

  test('says its own address where the workflow writes it in', () => {
    for (const page of ['README.md', 'index.html']) {
      expect(read('apt', page)).toContain('@BASE@/orden-archive-keyring.asc')
    }
  })
})

/** The dnf and zypper repository: apt.orden.so's bucket and key, under `rpm/` (#1147). What
 *  it installs on Fedora and openSUSE is rpm.yml's `try`, through scripts/rpm-try.sh. */
describe('the rpm repository', () => {
  const workflow = repo('.github', 'workflows', 'rpm.yml')
  const apt = repo('.github', 'workflows', 'apt.yml')
  const field = (text: string, name: string) => new RegExp(`${name}: (\\S+)`).exec(text)?.[1]

  test("is apt's key, address, bucket and account, and no secret of its own", () => {
    for (const name of ['APT_KEY_FINGERPRINT', 'APT_BASE_URL', 'R2_BUCKET', 'CF_ACCOUNT_ID']) {
      expect(field(workflow, name), name).toBe(field(apt, name))
    }
    const secrets = new Set([...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((found) => found[1]))
    expect([...secrets].sort()).toEqual(['APT_SIGNING_KEY', 'CLOUDFLARE_API_TOKEN'])
  })

  test('is written for stable by publish.yml and for unstable by release.yml', () => {
    for (const [caller, suite] of [
      [repo('.github', 'workflows', 'publish.yml'), 'stable'],
      [repo('.github', 'workflows', 'release.yml'), 'unstable'],
    ] as const) {
      expect(caller).toMatch(
        new RegExp(String.raw`uses: \./\.github/workflows/rpm\.yml
\s+with:
\s+suite: ${suite}
`),
      )
    }
    expect(workflow).toContain('workflow_call:')
  })

  test('goes into the bucket only once Fedora and openSUSE have installed it, on both architectures', () => {
    const publish = /\n {2}publish:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n|$)/.exec(workflow)?.[1] ?? ''
    expect(publish).toContain('needs: [write, try]')
    for (const one of ['fedora:latest', 'opensuse/tumbleweed:latest', 'ubuntu-24.04-arm']) {
      expect(workflow).toContain(one)
    }
  })

  test('signs every package and its index, and reads them back with the published key', () => {
    const script = repo('scripts', 'rpm-repo.sh')
    expect(script).toContain('rpmsign --addsign')
    expect(script).toContain('repomd.xml.asc')
    expect(script).toContain('packaging/apt/orden-archive-keyring.asc')
    expect(script).toMatch(/rpmkeys --dbpath "\$keys" --checksig/)
  })

  test('hands readers a .repo file that checks both signatures against the published key', () => {
    const file = read('rpm', 'orden.repo')
    for (const line of [
      'gpgcheck=1',
      'repo_gpgcheck=1',
      'gpgkey=@BASE@/orden-archive-keyring.asc',
      'baseurl=@BASE@/rpm/@SUITE@',
    ]) {
      expect(file).toContain(line)
    }
  })

  /** Fedora's and openSUSE's packages have different names for the same libraries, so the
   *  .rpm asks for the libraries themselves, which both provide by the same name. */
  test('asks for libraries by the names Fedora and openSUSE both give them', () => {
    const config = JSON.parse(repo('apps', 'desktop', 'src-tauri', 'tauri.conf.json')) as {
      bundle: { linux: { rpm: { depends: string[] } } }
    }
    const depends = config.bundle.linux.rpm.depends
    expect(depends.length).toBeGreaterThan(0)
    for (const one of depends) expect(one).toMatch(/^lib[\w.+-]+\.so(\.\d+)*\(\)\(64bit\)$/)
    expect(depends).toContain('libgtk-4.so.1()(64bit)')
  })
})

/** The snap: built and uploaded by snap.yml, called by publish-linux.yml for a release
 *  (`stable`) and by release.yml for edge (`edge`). Called, not dispatched: a dispatch
 *  finds only a workflow already on the default branch. See packaging/linux.md. */
describe('the snap workflow', () => {
  const snapYml = repo('.github', 'workflows', 'snap.yml')

  test('is called for a release and for edge', () => {
    expect(snapYml).toContain('workflow_call:')
    expect(repo('.github', 'workflows', 'publish-linux.yml')).toContain(
      'uses: ./.github/workflows/snap.yml',
    )
    const release = repo('.github', 'workflows', 'release.yml')
    expect(release).toMatch(
      /uses: \.\/\.github\/workflows\/snap\.yml\n\s+with:\n\s+tag: \$\{\{ needs\.version\.outputs\.tag \}\}/,
    )
    expect(release).not.toContain('gh workflow run snap.yml')
  })

  test('puts edge in the edge channel at devel grade and a release in stable', () => {
    expect(snapYml).toContain("echo 'channel=edge'")
    expect(snapYml).toContain("echo 'grade=devel'")
    expect(snapYml).toContain("echo 'channel=stable'")
    expect(snapYml).toContain('release: ${{ steps.channel.outputs.channel }}')
  })

  test("sets the checksum line to its own architecture's digest", () => {
    expect(snapYml).toContain('if [ "$ARCH" = arm64 ]; then own=$arm64; else own=$amd64; fi')
    expect(snapYml).toContain('source-checksum: sha256/).*|\\1$own|')
  })
})

/** The Linux managers for a stable release: called by release.yml, never dispatched and
 *  never started by `release: published`, which a release made on the workflow's own
 *  token does not raise. See packaging/linux.md. */
describe('the Linux publishing workflow', () => {
  const linux = repo('.github', 'workflows', 'publish-linux.yml')
  const release = repo('.github', 'workflows', 'release.yml')

  test('is called by release.yml with the release tag', () => {
    expect(linux).toContain('workflow_call:')
    expect(linux).not.toMatch(/^\s+release:\s*$/m)
    expect(release).toMatch(
      /uses: \.\/\.github\/workflows\/publish-linux\.yml\n\s+with:\n\s+tag: \$\{\{ needs\.version\.outputs\.tag \}\}/,
    )
    expect(release).not.toContain('gh workflow run publish-linux.yml')
  })

  test('publishes a stable tag and nothing else', () => {
    const stable = "if: ${{ startsWith(inputs.tag, 'v') && !contains(inputs.tag, '-') }}"
    expect(linux.split(stable)).toHaveLength(3)
  })
})

/** #427: Linux runs Orden on CEF (Chromium), and WebKitGTK's Orden - whose web process
 *  aborted on Fedora 44 against libraries newer than the ones it was built with - is no
 *  package's any more. The AUR's orden-git built it from source the WebKitGTK way until
 *  then, with WebKitGTK as a dependency, long after every release had moved. */
describe('the engine a Linux package runs', () => {
  const recipes = readdirSync(join(ROOT, 'aur')).filter((one) => !one.includes('.'))

  test.each(recipes)('%s needs no WebKitGTK', (name) => {
    const recipe = read('aur', name, 'PKGBUILD')
    const named = /depends=\(([^)]*)\)/.exec(recipe)?.[1] ?? ''
    expect(named).not.toMatch(/webkit/i)
    expect(named).toContain('nss')
  })

  test('and one built from source builds on CEF, as the release does', () => {
    const recipe = read('aur', 'orden-git', 'PKGBUILD')
    const build = /build\(\) \{([\s\S]*?)\n\}/.exec(recipe)?.[1] ?? ''
    expect(build).toContain('scripts/linux-cef.sh tauri build')
    expect(repo('.github', 'workflows', 'release.yml')).toContain(
      'scripts/linux-cef.sh tauri build',
    )
  })
})

/** #1135: the flake's orden-unstable is the `edge` pre-release's .deb, pinned in
 *  packaging/nix/edge.json, which release.yml rewrites on `unstable` after every edge
 *  build. */
describe('the Nix edge', () => {
  const release = repo('.github', 'workflows', 'release.yml')
  const job = /\n {2}nix-edge:\n([\s\S]*?)\n {2}\S/.exec(`${release}\n  .`)?.[1] ?? ''

  test('is pinned to an edge build of both architectures', () => {
    const pin = JSON.parse(read('nix', 'edge.json'))
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+-\d+$/)
    expect(pin.tag).toBe('edge')
    expect(pin.asset).toBe('Orden')
    expect(Object.keys(pin.hashes).sort()).toEqual(['aarch64-linux', 'x86_64-linux'])
    for (const hash of Object.values(pin.hashes)) {
      expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/)
    }
  })

  test('is read by the flake, which builds it as it builds the release', () => {
    const flake = read('nix', 'flake.nix')
    expect(flake).toContain('builtins.readFile ./edge.json')
    expect(flake).toContain('mkRelease (edgePin // { pname = "orden-unstable"; }) pkgs')
    expect(flake).toContain('orden = mkRelease stable pkgs;')
  })

  test('is moved after every edge build, on the run token alone', () => {
    expect(job).toContain("needs.version.outputs.rolling == 'true'")
    expect(job).toContain('node scripts/bump-packaging.mjs edge "$VERSION"')
    expect(job).toContain('git push -q origin HEAD:unstable')
    expect(job).not.toContain('secrets.')
    expect(job).not.toMatch(/--force|-f origin/)
  })

  test('and its own push builds nothing', () => {
    const ignored = /paths-ignore:\n([\s\S]*?)\n {2}workflow_dispatch:/.exec(release)?.[1] ?? ''
    expect(ignored).toContain('- packaging/nix/edge.json')
  })

  test('is started out of the pushed flake the way the release is', () => {
    expect(release).toMatch(
      /uses: \.\/\.github\/workflows\/nix\.yml\n\s+with:\n\s+flake: github:\$\{\{ github\.repository \}\}\/\$\{\{ needs\.nix-edge\.outputs\.sha \}\}\?dir=packaging\/nix\n\s+package: orden-unstable/,
    )
  })
})
