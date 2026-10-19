# Windows packaging

Three package managers carry Orden on Windows, and each takes the release's own files
rather than building anything: winget (`lxorb.Orden`), Scoop (`nib`, in
`lxorb/scoop-bucket`) and Chocolatey (`nib`). Scoop and Chocolatey are to move to `orden`,
and wait for it behind a switch; see "The rename: nib to orden" below. Homebrew's cask is
in `homebrew/` and goes out the same way.

| Directory | Manager | Installer it takes |
| --- | --- | --- |
| `scoop/orden.json` | Scoop (`scoop install lxorb/nib`; `lxorb/orden` after the rename) | the NSIS setup, unpacked rather than run |
| `chocolatey/orden.nuspec` | Chocolatey (`choco install nib`; `orden` after the rename) | the MSI, for the whole machine |
| `chocolatey/nib.nuspec` | Chocolatey (`choco upgrade nib`), after the rename | none: the road from the old name |
| `winget/` | winget | the NSIS setup |

## How a release gets there

`.github/workflows/publish.yml`, one job per manager, none waiting on another. It is
started by `release.yml`'s publish job once a stable release and every file on it are up,
as a dispatch (`gh workflow run publish.yml -f tag=v<version>`): a release made on the
workflow's own token raises no event another workflow hears. The same command sends a
release through again by hand, and every job is safe to run twice - the bucket and the tap
commit only what changed, and Chocolatey skips a version it already has (a 409, written in
the run's summary as skipped). A manager whose token is missing is skipped:
`PACKAGING_TOKEN` for the bucket and the tap, `CHOCOLATEY_API_KEY`, `WINGET_TOKEN`.

`scripts/bump-packaging.mjs` keeps the files here on the release they describe; see
packaging/linux.md, "Refreshing all of it for a new release".

## The rename: nib to orden

Up to 0.15.0 the Scoop app and the Chocolatey package were both `nib`, the product's
first name. Both are to be `orden`, with the old name kept as a road to the new one
rather than a dead end. The road is built, and held back.

### Held back, and why

`publish.yml` takes the road only when the repository variable `PACKAGE_RENAME` is
`true` (Settings, Secrets and variables, Actions, Variables). It is not set, so a release
publishes Orden as `nib` in both:

- **Scoop**: `bucket/nib.json` is bumped where it is - the version, the two setups' urls
  and digests - from the release's `scoop/orden.json`, without the five lines with which
  `orden` takes over what `nib` kept. No `orden.json` goes into the bucket and nothing
  goes into `deprecated/`.
- **Chocolatey**: `nib` alone is pushed, as an ordinary package at the release's version:
  `orden.nuspec` under the id `nib`, without the paragraph that says `nib` is the road to
  `orden`. Neither `orden` nor the deprecation is pushed.

Measured on 2026-10-18 (a throwaway workflow on `windows-latest`, Windows PowerShell
5.1.26100, run 39123041351): `Remove-Item -Force -Recurse` on the junction removed the link
and left its target alone, and both `scoop update nib` (which ran 0.15.0's uninstaller) and
`scoop uninstall nib` kept what was in the persist folder. So the first risk below did not
show on a current Windows. It is kept as a risk for older Windows 10 builds until one is
tried, and Chocolatey's is unchanged.

Two things stand in the way of the rename:

- **Scoop's `nib` 0.15.0 uninstaller** is `Remove-Item "$env:APPDATA\ch.emilvinu.nib"
  -Force -Recurse`, and that folder is a junction into the app's persist folder. Windows
  PowerShell 5.1 follows a junction with `-Recurse` and deletes what is behind it: the
  themes and the note history. The rename's note told everybody to run `scoop uninstall
  nib`, which would have run it on every machine that has `nib`. The uninstaller in
  `scoop/orden.json`, which `nib.json` is now written from too, removes the junction as a
  link alone (`.Delete()` on the item, which takes the reparse point and nothing under
  it). But Scoop runs the uninstaller of the version that is *installed*, on `scoop
  uninstall` and on `scoop update` alike: the first update away from 0.15.0 still runs
  0.15.0's. Under PowerShell 7 that removes the link alone; under Windows PowerShell 5.1
  it is the same risk. Removing the junction first, `cmd /c rmdir
  "%APPDATA%\ch.emilvinu.nib"` (which never touches what is behind it), makes the old
  uninstaller find nothing, and the new installer makes the junction again.
- **Chocolatey's deprecation** of `nib` depends on `orden`. A new package waits for
  moderation on the community repository, and `nib` is trusted and goes through at once,
  so the deprecated `nib` would be live before any `orden` it depends on could be
  installed, and `choco upgrade nib` would fail.

### Before setting PACKAGE_RENAME

On a Windows machine, in Windows PowerShell 5.1 and in PowerShell 7:

1. `scoop install lxorb/nib` at the version the bucket has, start Orden once, and put a
   theme in and edit a note, so the persist folder holds something.
2. Run `scoop update nib` to the release that writes the new `nib.json`, and check that
   `scoop\persist\nib` still holds the theme and the history, and that
   `%APPDATA%\ch.emilvinu.nib` is a junction to it again.
3. `scoop uninstall nib`, and check the same: the junction gone, the persist folder whole.
4. `scoop install` from a local copy of the bucket with this run's `orden.json` and
   `deprecated/nib.json` (the `true` road of the Scoop job), and check that `orden` takes
   over what `nib` kept.
5. Have `orden` approved on the community repository first: pack `orden.nuspec` as the
   publish job bumps it and `choco push` it by hand, and wait for moderation. Only then
   set `PACKAGE_RENAME`, so the deprecated `nib` goes out after an `orden` anybody can
   install.

### The road, once it is taken

**Scoop** has no rename. What it has is a bucket's `deprecated/` folder: a manifest there
still updates the app it installed, and `scoop status` says Deprecated beside it. So the
publish job writes `bucket/orden.json`, removes `bucket/nib.json`, and writes
`bucket/deprecated/nib.json` on the release's version, with the safe uninstaller and a
note saying where Orden is now: first `scoop update nib`, so that the uninstaller
that runs next is the safe one, then `scoop uninstall nib` and `scoop install orden`.
`orden`'s installer takes over what `nib` kept in its persist folder - themes and note
history, junctioned from `%APPDATA%\ch.emilvinu.nib` - the first time, while its own
persist folder is still empty. Its uninstaller removes that junction as a link alone, so
the persist folder stays until `scoop uninstall orden --purge`.

**Chocolatey** deprecates a package the way its documentation says
("Deprecate a Package", for a package superseded by another): a new version of the old
id, with `[Deprecated]` in front of its title, a description saying why, a dependency on
the package that replaces it, no files and no icon - and every older version unlisted on
the community repository but that last one, which is the road. `nib.nuspec` is that
package. It depends on `orden` at the release's version or later, so `choco upgrade nib`
installs `orden`, whose MSI upgrades Orden in place, and `choco upgrade all` keeps moving
`orden` on afterwards. `choco uninstall nib` then removes the empty package alone.

A deprecation has to be a version of `nib` newer than every one before it, and `nib` is
a real package up to the last release published under it. So the publish job pushes it
as the release's version with the day the release was published after it,
`0.17.0.20261101` for a 0.17.0 published on 1 November: newer than every `nib` before it,
and the same on every run for one release, so a second run is a 409 and skipped.

Unlisting the old `nib` versions on community.chocolatey.org is done by hand, on the
package's page; nothing here can.
