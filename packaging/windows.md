# Windows packaging

Three package managers carry Orden on Windows, and each takes the release's own files
rather than building anything: winget (`lxorb.Orden`, its manifest written from the
release by `publish.yml`, so none is kept here), Scoop (`orden`, in
`lxorb/scoop-bucket`) and Chocolatey (`orden`). Scoop and Chocolatey carried Orden as
`nib` before; see "The package that was nib" below. Homebrew's cask is in `homebrew/`
and goes out the same way.

| Directory | Manager | Installer it takes |
| --- | --- | --- |
| `scoop/orden.json` | Scoop (`scoop install lxorb/orden`) | the NSIS setup, unpacked rather than run |
| `chocolatey/orden.nuspec` | Chocolatey (`choco install orden`) | the MSI, for the whole machine |
| `chocolatey/nib.nuspec` | Chocolatey (`choco upgrade nib`), once | none: the last version of the old name |

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

## The package that was nib

The Scoop app and the Chocolatey package were both `nib`, the product's first name.
`publish.yml` publishes `orden` in both, with no switch, and gives each old name one
last version that says where Orden is now.

### Scoop

Scoop has no rename. What it has is a bucket's `deprecated/` folder, beside `bucket/`:
`scoop status` says Deprecated beside an app whose manifest is there. The publish job
writes `bucket/orden.json`. If it finds `bucket/nib.json`, it moves it to
`deprecated/nib.json` as it is, at the last version published under that name, with a
note in front saying where Orden is now: `scoop uninstall nib`, then
`scoop install orden`. That happens on the first run and never again.

`orden`'s installer takes over what `nib` kept in its persist folder - themes and note
history, junctioned from `%APPDATA%\so.orden.Orden` - the first time, while its own
persist folder is still empty. Its uninstaller removes that junction as a link alone, so
the persist folder stays until `scoop uninstall orden --purge`.

Scoop runs the uninstaller of the version that is installed. `nib` 0.15.0's is
`Remove-Item "$env:APPDATA\so.orden.Orden" -Force -Recurse`, and Windows PowerShell 5.1
on older Windows 10 builds may follow the junction and delete what is behind it. Later
versions of `nib` remove the link alone. Somebody still on `nib` 0.15.0 removes the
junction first, `cmd /c rmdir "%APPDATA%\so.orden.Orden"`, which never touches what is
behind it.

### Chocolatey

Chocolatey deprecates a package the way its documentation says ("Deprecate a Package",
for a package superseded by another): a new version of the old id, with `[Deprecated]`
in front of its title, a description saying why, a dependency on the package that
replaces it, no files and no icon. `nib.nuspec` is that package. It depends on `orden`
at the release's version or later, so `choco upgrade nib` installs `orden`, whose MSI
upgrades Orden in place. `choco uninstall nib` then removes the empty package alone.

The order matters, and the publish job keeps it:

1. `orden` is a new package and waits for moderation. While the community repository
   does not list it, the job pushes `orden` alone and leaves `nib` as it is.
2. Once `orden` is listed, run the job again for the newest release
   (`gh workflow run publish.yml -f tag=v<version>`), or let the next release do it. It
   pushes `nib` as the release's version with the day the release was published after
   it, `0.23.0.20261201` for a 0.23.0 published on 1 December: newer than every `nib`
   before it, and the same on every run for one release, so a second run is a 409 and
   skipped.
3. Once the repository lists `nib` as deprecated, the job pushes `orden` alone again.
   Then unlist every older `nib` version on the package's page on
   community.chocolatey.org, by hand, and delete `chocolatey/nib.nuspec`, its lines in
   `publish.yml` and `scripts/bump-packaging.mjs`, and its tests.
