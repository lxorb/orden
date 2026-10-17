# Linux packaging

Five package managers. Four of them repackage what
`.github/workflows/release.yml` already publishes rather than rebuilding
Orden, so a release is a release everywhere and nothing can drift between
them. Flathub is the exception and has to be: it only takes a source-available
app that is compiled from source inside its own sandbox.

| Directory | Manager | Built from | Architectures |
| --- | --- | --- | --- |
| `apt/` | apt (`apt install orden`, from `lxorb.github.io/apt`) | the `.deb` | amd64, arm64 |
| `aur/nib-bin/` | AUR (`yay -S orden-bin`) | the `.deb` | x86_64, aarch64 |
| `flathub/` | Flathub (`flatpak`) | source, in the sandbox | x86_64, aarch64 |
| `snap/` | Snap Store | the `.deb` | amd64, arm64 |
| `nix/` | a flake anyone can install from | the AppImage | x86_64, aarch64 |

`.github/workflows/validate-linux-packaging.yml` builds all four the way the
managers themselves do - `makepkg` in an Arch container, `flatpak-builder` plus
`flatpak-builder-lint` against the Flathub runtime, and `snapcraft` in LXD. Run
it after every release that changes packaging. The flake has its own,
`.github/workflows/nix.yml`, which runs on every pull request into `main` that
changes it.

`.github/workflows/publish-linux.yml` pushes a published release out to the AUR
and the Snap Store. Both jobs build and then stop short of uploading until their
secrets exist, so the workflow is harmless while the accounts below do not.

`.github/workflows/publish.yml` does the same for winget, Scoop, Homebrew and
Chocolatey, and also skips every manager whose token is missing, so nothing is
pushed anywhere until `PACKAGING_TOKEN`, `WINGET_TOKEN` and
`CHOCOLATEY_API_KEY` are set as repository secrets.

## What Tauri's .deb gives us, and what it gets wrong

```
Package: orden (Conflicts and Replaces: nib and nibeditor, its names up to 0.11 and 0.13)
Depends: libwebkit2gtk-4.1-0 (>= 2.40.0), gstreamer1.0-plugins-base, gstreamer1.0-plugins-good, libwebkit2gtk-4.1-0, libgtk-3-0
Recommends: gstreamer1.0-libav, gstreamer1.0-plugins-bad
usr/bin/nib
usr/share/applications/Orden.desktop (Nib.desktop up to 0.11, nibeditor.desktop up to 0.13)
usr/share/icons/hicolor/{32x32,128x128,256x256@2}/apps/nib.png
```

The binary and the icons are fine. The rest is not, and every package here
repairs the same three things:

- **`Categories=` is empty**, so Orden lands in no menu category at all. Tauri
  derives it from `bundle.category` in `tauri.conf.json`, which is unset.
- **No `MimeType=` and no `%U` on `Exec=`**, so nothing offers Orden as a web
  browser. Orden claims `x-scheme-handler/http` and `https`, which is what lets it be
  the default browser (see `default_browser.rs`), and of files only
  `application/pdf`, for a file manager's "Open with" (see `handed_pdfs.rs`): it
  opens no note from outside its spaces, so a `.md` in a file manager is never
  offered to it.
- **The 256x256 icon is filed under `256x256@2`**, a scale-2 directory, where a
  256x256 image means "128 logical pixels at 2x" and every theme lookup scales
  it wrong. Tauri puts `128x128@2x.png` there by name rather than by size.

`Description:` in the control file is also literally `(none)` and `Maintainer:`
has no email address. Fixing this upstream means setting `bundle.category`,
`bundle.shortDescription`/`longDescription` and `bundle.publisher` in
`tauri.conf.json`; the web handlers would still have to be added by hand.

Each package therefore installs its own `.desktop` entry and moves the icon.
The three copies differ only where they have to: the Flatpak one is named after
the app ID and points `Icon=` at it, the snap one points `Icon=` at `${SNAP}`.

## What Orden needs of the system

**WebKitGTK 2.40 or newer.** A web tab's state is read and written in a script
world of its own through `webkit_web_view_call_async_javascript_function`, which
is new in 2.40, so the crate builds `webkit2gtk` with its `v2_40` feature
(`apps/desktop/src-tauri/Cargo.toml`, `src/web_state/isolated.rs`). wry on its
own asks for 2.38. Every distribution packaged here is past it: Ubuntu 22.04 has
2.50 and 24.04 2.52 in their updates, Debian 12 2.50 and 13 2.54, Arch 2.54, and the snap's
gnome-46-2404 platform 2.52.

**GStreamer's -base and -good plugins.** WebKitGTK plays and records sound and
video through GStreamer, and what Orden plays is its own: a voice note in a chat,
a recording embedded in a note, a picture's or a video's preview in a chat's
gallery. A recording on Linux is Opus in WebM (`recorder/container.ts`): Opus is
in -base, WebM (and MP4) in -good, and so is the source and sink for the sound
server. Debian's and Ubuntu's `libwebkit2gtk-4.1-0` already depend on both; Arch's
`webkit2gtk-4.1` depends only on GStreamer's libraries and leaves every plugin
optional, so the AUR package names them.

**gst-libav and -bad, recommended.** A recording made on a Mac or an iPhone is AAC
in MP4 (`.m4a`), and a video from a phone is H.264 or HEVC; GStreamer decodes those
in gst-libav (`avdec_aac`, `avdec_h264`), with -bad holding most of the remaining
formats. Without them the file is there and does not play, and nothing else in the
app is affected, so they are what Debian calls Recommends (Debian 13 recommends
them for WebKitGTK already; Ubuntu only suggests them) and the AUR `optdepends`.

| | WebKitGTK | required | recommended |
| --- | --- | --- | --- |
| `.deb` (`tauri.conf.json` `bundle.linux.deb`) | `libwebkit2gtk-4.1-0 (>= 2.40.0)` | `gstreamer1.0-plugins-base`, `-good` | `gstreamer1.0-libav`, `-plugins-bad` |
| AUR (`PKGBUILD`) | `webkit2gtk-4.1>=2.40` | `gst-plugins-base`, `gst-plugins-good` | `gst-libav`, `gst-plugins-bad` (`optdepends`) |
| snap | the platform's, 2.52 | the platform's | none: not in the platform |
| Nix | nixpkgs' | `gstPluginsFor` in the flake: all five | - |

The `.rpm` names neither: Tauri writes its requirements as sonames
(`libwebkit2gtk-4.1.so.0()(64bit)`), which carry no version, and Fedora and
openSUSE spell every package above differently.

The snap has no way to recommend a package, and stages nothing beside the platform
on purpose (see below). gnome-46-2404 carries -base, -good, PipeWire's and the GL
plugins, so recordings and WebM play; AAC and H.264 do not. Staging gst-libav would
not be enough to change that: its libavfilter is not in the platform, and the
platform's launcher puts no directory of the snap's own on the library path.

## apt - `lxorb/apt`

An apt repository of our own, on GitHub Pages: `lxorb/apt`, served at
`https://lxorb.github.io/apt`. The address lives in one place, the repository variable
`APT_BASE_URL` (that default when it is unset), which `apt.yml` writes into the
repository's own page; a move to `apt.orden.so` is that variable, a `CNAME` in `lxorb/apt`
and the lines below.

Two suites, one component, `main`, and both architectures:

- `stable`: the newest release. `publish.yml` calls `apt.yml` for every stable tag,
  with the other package managers.
- `unstable`: the newest `edge` build. `release.yml` calls it once edge's files are up.

Both call it (`uses:`) rather than dispatching it: a dispatch only finds a workflow that is
on the default branch already, and `apt.yml` reaches `unstable` first.

**Each suite holds one version, the newest.** A run empties that suite's pool, puts the
release's two `.deb`s in, writes its `Packages` and `Release` again and signs it; the
other suite is taken from the repository as it is. Every older `.deb` stays on its release
page. The repository is pushed as a single commit with no history, because every `.deb`
that ever went in would otherwise stay in a repository Pages serves - thirty megabytes for
every edge build.

**Written with `apt-ftparchive` and `gpg`**, in `scripts/apt-repo.sh`, and nothing else:
no `reprepro` database or `aptly` state to keep beside the files, so the checkout of
`lxorb/apt` is the whole of the state, a run reads it as it finds it, and the layout is the
plain one apt reads:

```
dists/<suite>/InRelease, Release, Release.gpg
dists/<suite>/main/binary-{amd64,arm64}/Packages, Packages.gz
pool/<suite>/orden_<version>_<arch>.deb
orden-archive-keyring.asc, orden-archive-keyring.gpg, index.html, README.md
```

**The key** is `APT_SIGNING_KEY`, a repository secret: ed25519 with no passphrase,
`Orden packages <emil@emilvinu.ch>`, fingerprint
`44404B19539FB2C53F31086941F0103448A194DE`. Its public half is
`apt/orden-archive-keyring.asc` here and at the root of the repository, and a run whose
secret is not that key refuses to sign. Without the key or `PACKAGING_TOKEN` the run is
skipped. `InRelease` and `Release.gpg` both, so every apt finds the signature it asks for.

Adding it, for `stable` (`Suites: unstable` for the edge builds):

```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://lxorb.github.io/apt/orden-archive-keyring.asc | sudo tee /etc/apt/keyrings/orden.asc >/dev/null
sudo tee /etc/apt/sources.list.d/orden.sources >/dev/null <<'EOF'
Types: deb
URIs: https://lxorb.github.io/apt
Suites: stable
Components: main
Signed-By: /etc/apt/keyrings/orden.asc
EOF
sudo apt update
sudo apt install orden
```

The one-line form, for an apt older than 2.3 that reads no `.sources` file:
`deb [signed-by=/etc/apt/keyrings/orden.asc] https://lxorb.github.io/apt stable main` in
`/etc/apt/sources.list.d/orden.list`. The keyring may be the armored `.asc`; apt reads
either. The app leaves an install from here to apt and only says when a new version is out
(`package_manager.rs`).

By hand, once `apt.yml` is on main: `gh workflow run apt.yml -f suite=stable -f tag=v0.15.0`,
or `-f suite=unstable -f tag=edge`.

## AUR - `orden-bin`

`aur/nib-bin/` is the package base as the AUR wants it: `PKGBUILD`, the
generated `.SRCINFO`, and the `nib.desktop` that replaces Tauri's. The package
is `orden-bin`; the folder, the binary, the icon and the desktop entry keep the
name `nib`. It unpacks the `.deb` with `bsdtar`, so installing Orden pulls in no
Rust or Node toolchain.

Neither `orden-bin` nor `orden` is in the AUR (checked 2026-10-12), and neither
the official repositories nor the AUR has a `nib`, so `provides=nib` and
`conflicts=nib` are free. (`nib-git` in the AUR is an unrelated, orphaned Python
static site generator.) The package was never published as `nib-bin`.

### Steps to publish it - needs your account

The AUR has no organisation accounts and no way to delegate, so the account and
the key have to be yours.

1. Register at <https://aur.archlinux.org/register>. The form wants a username,
   an email address and an SSH **public** key; you can add the key later from
   *My Account*.
2. Make a key for this and nothing else. It must have no passphrase - a workflow
   cannot type one:

   ```
   ssh-keygen -t ed25519 -N "" -C "aur@nib" -f ~/.ssh/aur_nib
   ```

3. Paste the contents of `~/.ssh/aur_nib.pub` into *SSH Public Key* on
   <https://aur.archlinux.org/account/> and save.
4. Hand the private key and your account details to the repository:

   ```
   gh secret set AUR_USERNAME --repo lxorb/orden --body "<your AUR username>"
   gh secret set AUR_EMAIL    --repo lxorb/orden --body "<the email on the account>"
   gh secret set AUR_SSH_PRIVATE_KEY --repo lxorb/orden < ~/.ssh/aur_nib
   ```

5. Publish the current release:

   ```
   gh workflow run publish-linux.yml --repo lxorb/orden -f tag=v0.13.1
   ```

   The AUR creates the package base on first push, so there is nothing to
   register by hand. From then on every published release pushes itself.

If you would rather do the first push yourself:

```
git clone ssh://aur@aur.archlinux.org/orden-bin.git
cp packaging/aur/nib-bin/{PKGBUILD,.SRCINFO,nib.desktop} orden-bin/
cd orden-bin && git add -A && git commit -m "orden 0.13.1" && git push
```

## Flathub

`flathub/` holds a submission the way Flathub wants one: the manifest, the
AppStream metainfo, the desktop entry, and the two generated files that let the
whole thing build with no network.

**It builds from source, because it has to.** Flathub's requirements gained a
*Building from source* section on 2026-02-25:

> All source available submissions must be built entirely from source code.

Orden is AGPL, so it is a source-available submission, and a manifest that
unpacked the release `.deb` would be closed on sight. The Tauri apps on Flathub
that do exactly that were accepted before the date and are grandfathered, not
precedent. The exception clause covers well-known vendors with no offline build
tooling, which is not our case either way: the tooling exists.

### The two generated files

Nothing may be fetched while a Flathub build runs, so every crate and every npm
tarball is a source in the manifest. Two generators from
<https://github.com/flatpak/flatpak-builder-tools> write them:

```
python -m pip install aiohttp tomlkit yarl
python cargo/flatpak-cargo-generator.py apps/desktop/src-tauri/Cargo.lock \
  -o packaging/flathub/cargo-sources.json

pipx install "git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node"
flatpak-node-generator pnpm pnpm-lock.yaml -o packaging/flathub/node-sources.json
```

Both are large and mechanical, both belong to the same commit as the app, and
both have to be regenerated whenever either lockfile moves. Run them on Linux:
the node one writes the host's path separators into its output, and a build in
the sandbox cannot use Windows ones.

Only the desktop app is compiled. `tauri.conf.json` bundles no `externalBin`, so
there is no sidecar to vendor a third lockfile for; the MCP server is part of the
Worker under `services/sync/` and has nothing to do with the Flatpak.

### What the build does

The module unpacks the pnpm version the root `packageManager` field asks for,
installs `@nib/desktop` and the packages it is built from out of the offline
store, empties the updater's endpoints, builds the web assets with vite,
compiles the binary against the vendored crates, and installs the binary, the
icons, the desktop entry and the metainfo by hand.

`cargo build` rather than `tauri build`: the only thing the bundler would add is
a `.deb`, and nothing in it is used - Tauri's own desktop entry and icon layout
are the three things every package here repairs anyway.

**No self-updating.** A Flatpak is updated by Flathub, so the build leaves the
updater plugin with an empty endpoint list. The plugin stays configured, because
its public key is not optional and the app will not start without it, and an
empty list is what the app already treats as nothing new - the same as having no
network. `createUpdaterArtifacts` goes off with it.

Build and install it locally exactly the way the workflow does:

```
cd packaging/flathub
flatpak install -y flathub org.flatpak.Builder org.gnome.Platform//50 org.gnome.Sdk//50
flatpak run org.flatpak.Builder --force-clean --sandbox --user --install \
  --install-deps-from=flathub --repo=repo builddir so.orden.Orden.yml
flatpak run so.orden.Orden
```

`--sandbox` is the part that matters: it takes the network and the host
filesystem away from the build commands, which is the condition Flathub builds
under.

The manifest sets no `WEBKIT_DISABLE_DMABUF_RENDERER`, and does not need one:
the window comes up on the GNOME 50 runtime with `--device=dri` and nothing
else. If a blank window is ever reported on a proprietary driver, that variable
set to 1 in `finish-args` is the usual fix, and the reason other Tauri Flatpaks
carry it.

### What the linters say

`appstreamcli validate`, `desktop-file-validate`, `flatpak-builder-lint
manifest` and `flatpak-builder-lint appstream` all pass, and the built Flatpak
resolves every library it needs against `org.gnome.Platform//50`, which carries
`libwebkit2gtk-4.1.so.0` alongside the GTK4 flavour.

`flatpak-builder-lint repo` on a locally built repository reports exactly two
errors, `appstream-external-screenshot-url` and
`appstream-remote-icon-not-mirrored`. Neither is a defect: the composed
catalogue is complete - the screenshot is fetched, scaled into five thumbnails,
and the icons are both cached and remote - but the paths stay relative to the
`media_baseurl` attribute until Flathub's own build service rewrites them
absolute, and the linter skips both checks inside that pipeline. The validation
workflow asserts they are the only two errors rather than ignoring the check.

The screenshot itself is `docs/media/screenshot.png`, taken by
`apps/desktop/test/e2e/store-shot.py` and pointed at by commit through
`raw.githubusercontent.com`. Flathub refetches it on every build, so it has to
be a file in this repository and not the GitHub `user-attachments` link it used
to be - that one answers a GET with a redirect to a signed S3 URL that expires
in five minutes and refuses HEAD outright.

The name in the metainfo and the desktop entry is `Orden`, and the app ID is
`so.orden.Orden`. Flathub requires the matching domain to be yours and to
answer over HTTPS, which <https://orden.so> does.

The app ID is deliberately not the Tauri bundle identifier: that is still
`ch.emilvinu.nib`, and it names the data directory, the macOS bundle and the
Windows registry entries of every install already out there, so it is not a
string to change for packaging's sake. The two only have to meet in one place.
The single-instance plugin claims a bus name derived from the identifier, and a
sandbox may own names under its own app ID alone, so the manifest asks for that
one name with `--own-name`. Aligning the identifier would retire the hole and
migrate every existing install's data directory; until that is worth doing, the
`--own-name` lines are the price.

### Steps to submit it - needs your account

Flathub's requirements say plainly that AI tools must not open or automate
submission pull requests, or write their commit messages, descriptions or
review replies, and that AI-generated packaging has to be disclosed. So this is
yours to open, and the disclosure belongs in the pull request body.

1. Fork <https://github.com/flathub/flathub> with *Copy the master branch only*
   unchecked, and clone the `new-pr` branch:

   ```
   git clone --branch=new-pr git@github.com:<you>/flathub.git
   git checkout -b so.orden.Orden
   ```

2. Copy the five files in `packaging/flathub/` to the root of that branch, push,
   and open the pull request against `new-pr` titled `Add so.orden.Orden`.
3. Comment `bot, build` on it to make Flathub's builders build both
   architectures.
4. Two things worth saying in the pull request itself:
   - the packaging was written with an AI assistant, which their requirements
     ask you to disclose;
   - the manifest asks for `--filesystem=xdg-documents` rather than
     `--filesystem=home`, because the linter treats `home` as an error, and
     because it is all Orden needs: the spaces are in `~/Documents/Nib`, Orden opens
     nothing from outside them, and an export saved elsewhere goes through the
     document portal of the save dialog.
5. Once it is merged and published, verification is a token you serve yourself:
   put the line Flathub gives you at
   <https://emilvinu.ch/.well-known/org.flathub.VerifiedApps.txt>. That is what
   puts the verified mark on the listing, and it also gates the automerge
   setting below.

When the app is on Flathub, a release opens its own pull request: the
`x-checker-data` block on the git source lets Flathub's
flatpak-external-data-checker move the tag. It cannot regenerate the two source
files, though, so a release whose lockfiles moved needs them regenerated in the
same pull request or the build fails. Do not turn on `automerge-flathubbot-prs`
for that reason.

## Snap Store

`snap/snapcraft.yaml` unpacks the `.deb` (`source-type: deb`) and stages nothing
of its own: the `gnome` extension's platform snap carries GTK, WebKitGTK 4.1 and
libsoup3, and binds the `webkit2gtk-4.1` helper directory in from there. A staged
second copy of the library would pair a WebKit UI process with web process
helpers from a different WebKit, which is how a Tauri window ends up blank.
Strict confinement: the spaces are reached through `home`, an export saved to a
stick through `removable-media`, and nothing else is needed.

It pins the bytes it unpacks. `source-checksum` carries a `sha256/` per
architecture, and `publish-linux.yml` rewrites both from what the release page
reports for `Orden-<version>-linux-x64.deb` and `-arm64.deb` at the same moment it
rewrites the version and the URL - a release whose page reports no digest fails the
step rather than building an unchecked snap. Every other path here pins one too
(scoop and chocolatey a sha256, homebrew a sha256, the AUR a sha256, nix a hash,
Flathub a commit), and this was the one that did not: what the snap unpacks is a
file fetched over the network on a runner, and the Snap Store publishes it under the
product's name. **When a release is made by hand rather than by the workflow, update
the two digests in `snap/snapcraft.yaml` with it** - `gh release view v<version>
--json assets --jq '.assets[] | select(.name | test("linux.*deb$")) | "\(.name)
\(.digest)"'` prints both.

`source-checksum` is one line, for the architecture being built. snapcraft takes the
`- on amd64:` grammar for `source` but not for the checksum: snapcraft 8.11.1 refuses
the list with "Input should be a valid string", so a snap with a digest per
architecture never built. Both digests are kept as a record in the comment above the
line, `scripts/bump-packaging.mjs` rewrites both and puts amd64's in the line, and
`publish-linux.yml` copies its runner's into the line before it builds.

Worth doing because Ubuntu's App Center is the first place a great many Linux
desktop users look for software, and a snap is the only way to be in it.

### Steps to publish it - needs your account

`snapcraft` is Linux-only, so run these in WSL
(`sudo snap install snapcraft --classic`) or on any Linux box.

1. Make an Ubuntu One account at <https://snapcraft.io/account> if you have
   none, then `snapcraft login`.
2. Claim the name - nothing is published under it today:

   ```
   snapcraft register orden
   ```

3. Export credentials scoped to that one snap and hand them over:

   ```
   snapcraft export-login --snaps orden \
     --acls package_access,package_push,package_update,package_release \
     snapcraft-creds.txt
   gh secret set SNAPCRAFT_STORE_CREDENTIALS --repo lxorb/orden < snapcraft-creds.txt
   rm snapcraft-creds.txt
   ```

4. `gh workflow run publish-linux.yml --repo lxorb/orden -f tag=v0.13.1` uploads
   both architectures to the stable channel.

The first upload of a graphical snap goes through a manual review if it asks for
anything unusual; this one does not, so it should pass automatically.

## Nix

`nix/flake.nix` is one file holding both channels, and it is the same file on every
branch: `packages.default` and `packages.orden` are the release out of its `.deb`,
`packages.orden-unstable` compiles the sources beside the flake. It used to be two
different files at the one path, the release flake on main and the source flake on
`unstable`, which meant every release pull request either conflicted here or
quietly carried the source flake onto main and broke
`nix profile install github:lxorb/orden?dir=packaging/nix` for everyone already on
it. Nothing in the flake asks which branch it is on.

The release build takes the program out of the release `.deb` and runs it on
nixpkgs' own WebKitGTK, GTK and GStreamer, with `autoPatchelfHook` and
`wrapGAppsHook3`, the way nixpkgs packages other Tauri apps and the way the AUR
package runs it on Arch's. Up to 0.13 it wrapped the AppImage instead, which broke
on NixOS: the AppImage's own libwayland-client and GLib do not match the system's
Mesa and libglvnd (WebKit's web process aborts with `Could not create default EGL
display: EGL_BAD_PARAMETER`), its start script forces `GDK_BACKEND=x11`, and its
GStreamer 1.20 refuses nixpkgs' plugins. Built on nixpkgs it is a native Wayland
client, uses the driver NixOS keeps in `/run/opengl-driver`, and plays media. The
wrapper turns WebKit's DMA-BUF renderer off on NVIDIA's own driver alone (the
blank-window bug), unless `WEBKIT_DISABLE_DMABUF_RENDERER` is set either way;
Mesa keeps it. GStreamer loads its own plugins and nothing else: a
`GST_PLUGIN_PATH` the session carries (a NixOS profile's `lib/`, Qt and KDE
plugins and all) is dropped, and its registry is the package's own. No
`LD_PRELOAD`, no `GDK_BACKEND`. The command is `orden`, with `nib` beside it; the desktop entry and
icons are installed alongside, so it shows up in a launcher.

This is deliberately not a nixpkgs package. nixpkgs wants a maintainer who
watches the build, and search.nixos.org is the only place a nixpkgs entry would
be more discoverable than this flake - a small audience for a large standing
commitment. The flake costs nothing and works today:

```
nix run github:lxorb/orden?dir=packaging/nix
nix profile install github:lxorb/orden?dir=packaging/nix
```

On NixOS, as an input of the system's flake, either the package itself or
`overlays.default`, which builds it out of the system's own nixpkgs:

```nix
inputs.orden.url = "github:lxorb/orden?dir=packaging/nix";
inputs.orden.inputs.nixpkgs.follows = "nixpkgs";
# then, in a module:
environment.systemPackages = [ inputs.orden.packages.${pkgs.system}.default ];
```

Under Home Manager the same input goes in `home.packages` instead, as
`home.packages = [ inputs.orden.packages.${pkgs.system}.default ];`, which puts it
in one user's profile rather than the system's. There is no Home Manager module
here, and none is needed: it is a package like any other.

For the edge rather than the release, install the `orden-unstable` package, named
explicitly, from the `unstable` branch. It compiles that branch's source and follows
the unstable updater channel by default, and it has its own command, desktop entry
and icons, so it installs beside the release rather than over it:

```
nix profile install github:lxorb/orden/unstable?dir=packaging/nix#orden-unstable
nix profile upgrade --all    # either one moves to its newest build
```

The attribute has to be named: `default` is the release on every branch now, so
leaving it off installs the release from a flake fetched off `unstable`. Name the
repository and not just the directory - `?dir=packaging/nix` is how Nix is handed
the whole tree with the flake inside it, and the source build needs the workspace
next to it. `path:packaging/nix`, which copies that directory alone, leaves the
release outputs working and `orden-unstable` as a derivation that says what is
missing when somebody builds it.

Its Cargo dependencies are vendored straight out of `Cargo.lock`, so they carry no
hash to go stale. Its pnpm dependencies need a fixed-output hash, which is pinned in
the flake and is the same on both architectures (the fetcher runs `pnpm install
--force`, taking every platform's optional packages). That hash is the one thing in
the flake that moves with a lockfile rather than with a release: when `pnpm-lock.yaml`
moves past it the source *build* fails and names the hash it wanted, while
`nix flake check` and `nix eval` never touch it, so a stale one cannot break the
release outputs or the check on main. `gh workflow run nix.yml -f resolve_source_hashes=true`
resolves and validates it on a runner before it is committed here.

Two channels and no third. There is no branch holding a flake pinned to the
binaries of the `edge` pre-release: that was `nix-edge`, main plus a commit of
edge pins, force-pushed on every build, and it is gone. Main carries releases
and nothing else now, so a flake following main is a flake following the
release. Someone who wants the edge on Nix compiles the branch, which is the one
place this differs from the other package managers: everywhere else the edge
arrives as the same prebuilt .deb the `edge` pre-release carries.

The release package needs no binary cache, and nothing is compiled for it: the
build unpacks a 13 MB .deb, points its program at nixpkgs' libraries and writes
a shell wrapper, about four seconds on a CI runner, plus the download of the
.deb from the release, which a cache would only replace with a download of the
same size. Everything else comes from cache.nixos.org already. `orden-unstable`
is the exception, since it builds the app from source.

`flake.lock` pins nixpkgs, because Nix refuses to run a flake from GitHub whose
lock file it would have to write. Every release moves it (see below), so it is
never older than the release.

`.github/workflows/nix.yml` runs `nix flake check`, builds the flake on x86_64
and aarch64, and starts Orden out of it twice on each in a headless sway
(wlroots, like Hyprland), with Mesa where NixOS keeps it: once with Xwayland off
and no `DISPLAY`, so the window is a native Wayland one, and once on X11 through
Xwayland (`scripts/nix-start.sh`). On a pull request into `main` it builds the
flake in the checkout; by hand, and when `packaging-bump.yml` calls it, the flake it
is handed, from GitHub exactly as `nix run` above does. It starts the release build; `-f resolve_source_hashes=true` builds
`orden-unstable` instead.

## Refreshing all of it for a new release

`publish.yml` and `publish-linux.yml` rewrite the version and the checksums in
flight, so a release publishes itself and nothing here has to be edited first.
The files do stay pinned to the release they describe, which is what makes the
validation workflow meaningful and what `nix run` installs. A stable release moves
them by itself: `release.yml` dispatches `packaging-bump.yml`, which runs
`scripts/bump-packaging.mjs` over the flake, the PKGBUILD and its `.SRCINFO`,
`snapcraft.yaml`, the Scoop manifest, the Chocolatey package and the cask, with the
digests the release page reports, and runs `nix flake update` on the flake. It
checks the `.SRCINFO` against `makepkg`, builds
and starts the flake (nix.yml), opens a pull request and merges it, then starts
the flake once more from GitHub. A build of main never gets there. By hand:

```
gh workflow run packaging-bump.yml --repo lxorb/orden -f tag=v0.15.0 -f dry_run=true
node scripts/bump-packaging.mjs 0.15.0   # the same rewrite, locally
```

Flathub is the one it leaves alone, because it builds from source:

- `flathub/so.orden.Orden.yml`: the `tag` and the `commit` on the git source,
  plus a `<release>` entry in `so.orden.Orden.metainfo.xml`. If either lockfile
  moved in that release, regenerate `cargo-sources.json` and `node-sources.json`
  as well - a stale one fails the build rather than building the wrong thing.
