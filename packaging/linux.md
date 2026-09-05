# Linux packaging

Four package managers, one artifact. Every package here repackages what
`.github/workflows/release.yml` already publishes rather than rebuilding Nib, so
a release is a release everywhere and nothing can drift between them:

| Directory | Manager | Built from | Architectures |
| --- | --- | --- | --- |
| `aur/nib-bin/` | AUR (`yay -S nib-bin`) | the `.deb` | x86_64, aarch64 |
| `flathub/` | Flathub (`flatpak`) | the `.deb` | x86_64, aarch64 |
| `snap/` | Snap Store | the `.deb` | amd64, arm64 |
| `nix/` | a flake anyone can install from | the AppImage | x86_64, aarch64 |

`.github/workflows/validate-linux-packaging.yml` builds all four the way the
managers themselves do - `makepkg` in an Arch container, `flatpak-builder` plus
`flatpak-builder-lint` against the Flathub runtime, `snapcraft` in LXD, and
`nix build`. Run it after every release that changes packaging.

`.github/workflows/publish-linux.yml` pushes a published release out to the AUR
and the Snap Store. Both jobs build and then stop short of uploading until their
secrets exist, so the workflow is harmless while the accounts below do not.

## What Tauri's .deb gives us, and what it gets wrong

```
Depends: libwebkit2gtk-4.1-0, libgtk-3-0
usr/bin/nib
usr/share/applications/Nib.desktop
usr/share/icons/hicolor/{32x32,128x128,256x256@2}/apps/nib.png
```

The binary and the icons are fine. The rest is not, and every package here
repairs the same three things:

- **`Categories=` is empty**, so Nib lands in no menu category at all. Tauri
  derives it from `bundle.category` in `tauri.conf.json`, which is unset.
- **No `MimeType=` and no `%F` on `Exec=`**, so nothing offers Nib as a handler
  for a `.md` file even though the binary happily opens paths given to it. Tauri
  does not turn `bundle.fileAssociations` into a MIME type on Linux; only macOS
  and Windows get that.
- **The 256x256 icon is filed under `256x256@2`**, a scale-2 directory, where a
  256x256 image means "128 logical pixels at 2x" and every theme lookup scales
  it wrong. Tauri puts `128x128@2x.png` there by name rather than by size.

`Description:` in the control file is also literally `(none)` and `Maintainer:`
has no email address. Fixing this upstream means setting `bundle.category`,
`bundle.shortDescription`/`longDescription` and `bundle.publisher` in
`tauri.conf.json`; the MIME type would still have to be added by hand.

Each package therefore installs its own `.desktop` entry and moves the icon.
The three copies differ only where they have to: the Flatpak one is named after
the app ID and points `Icon=` at it, the snap one points `Icon=` at `${SNAP}`.

## AUR - `nib-bin`

`aur/nib-bin/` is the package base as the AUR wants it: `PKGBUILD`, the
generated `.SRCINFO`, and the `nib.desktop` that replaces Tauri's. It unpacks
the `.deb` with `bsdtar`, so installing Nib pulls in no Rust or Node toolchain.

`nib-bin` is unclaimed, and neither the official repositories nor the AUR has a
`nib`, so `provides=nib` and `conflicts=nib` are free. (`nib-git` in the AUR is
an unrelated, orphaned Python static site generator.)

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
   gh secret set AUR_USERNAME --repo lxorb/nib --body "<your AUR username>"
   gh secret set AUR_EMAIL    --repo lxorb/nib --body "<the email on the account>"
   gh secret set AUR_SSH_PRIVATE_KEY --repo lxorb/nib < ~/.ssh/aur_nib
   ```

5. Publish the current release:

   ```
   gh workflow run publish-linux.yml --repo lxorb/nib -f tag=v0.4.0
   ```

   The AUR creates the package base on first push, so there is nothing to
   register by hand. From then on every published release pushes itself.

If you would rather do the first push yourself:

```
git clone ssh://aur@aur.archlinux.org/nib-bin.git
cp packaging/aur/nib-bin/{PKGBUILD,.SRCINFO,nib.desktop} nib-bin/
cd nib-bin && git add -A && git commit -m "nib 0.4.0" && git push
```

## Flathub

`flathub/` holds the three files a Flathub submission is made of - the manifest,
the AppStream metainfo and the desktop entry. `appstreamcli validate` and
`flatpak-builder-lint manifest` - the check Flathub runs on a submission - both
pass, and the built Flatpak resolves every library it needs against
`org.gnome.Platform//50`, which carries `libwebkit2gtk-4.1.so.0` alongside the
GTK4 flavour.

`flatpak-builder-lint repo` on a locally built repository reports exactly two
errors, `appstream-external-screenshot-url` and
`appstream-remote-icon-not-mirrored`. Neither is a defect: the composed
catalogue is complete - the screenshot is fetched, scaled into five thumbnails,
and the icons are both cached and remote - but the paths stay relative to the
`media_baseurl` attribute until Flathub's own build service rewrites them
absolute, and the linter skips both checks inside that pipeline. The validation
workflow asserts they are the only two errors rather than ignoring the check.

**Not submitted yet, and not because of a bug.** Flathub's requirements gained a
*Building from source* section on 2026-02-25:

> All source available submissions must be built entirely from source code.

Nib is AGPL, so it is a source-available submission, and a manifest that unpacks
the release `.deb` does not qualify. The eleven Tauri apps on Flathub that do
exactly this were all accepted before that date and are grandfathered, not
precedent; every Tauri submission since builds from source. The exception clause
covers "well-known vendors" where offline-build tooling does not exist, which is
neither of Nib's situation.

What a submittable manifest needs on top of what is here:

- `cargo-sources.json` from `flatpak-cargo-generator.py` over
  `apps/desktop/src-tauri/Cargo.lock`, and another for `services/mcp` if the MCP
  sidecar is bundled.
- `node-sources.json` from `flatpak-node-generator pnpm pnpm-lock.yaml`. pnpm
  support landed in flatpak-builder-tools on 2026-03-12, so this is possible
  now; it was not before.
- `org.freedesktop.Sdk.Extension.rust-stable` and `.node22` as
  `sdk-extensions`, an offline `pnpm install`, and `tauri build --bundles deb`
  inside the sandbox with the updater disabled.

Both generated files are large and mechanical, and they have to be regenerated
whenever a lockfile moves. Until then the manifest here is still worth having:
it is how you build and install Nib as a Flatpak locally, and it is the base the
from-source version starts from.

```
cd packaging/flathub
flatpak install -y flathub org.flatpak.Builder org.gnome.Platform//50 org.gnome.Sdk//50
flatpak run org.flatpak.Builder --force-clean --sandbox --user --install \
  --repo=repo builddir ch.emilvinu.nib.yml
flatpak run ch.emilvinu.nib
```

The app ID is the Tauri bundle identifier, `ch.emilvinu.nib`, and Flathub
requires the matching domain to be yours and to answer over HTTPS.
<https://emilvinu.ch> does, so the ID stands as it is.

Two things to raise in the submission itself:

- The manifest asks for `--filesystem=xdg-documents` rather than
  `--filesystem=home`, because the linter treats `home` as an error. Files
  picked in a dialog arrive through the document portal regardless, but a
  recently-opened file kept outside ~/Documents will not reopen on its own.
  Editors are the usual case for a `home` exception, so ask for one in the pull
  request rather than shipping the narrower permission and living with it.
- The screenshot URL is worth moving. The GitHub `user-attachments` link does
  work - appstreamcli fetched the 1999x1423 PNG through it - but it answers a
  GET with a 302 to a signed S3 URL that expires in five minutes and refuses
  HEAD with a 403. Nothing about it is guaranteed to keep working, and Flathub
  refetches it on every build. A plain `.png` under `docs/media/` served from
  `raw.githubusercontent.com` is the durable form.

When the app is on Flathub, releases need no workflow: the
`x-checker-data` blocks in the manifest let Flathub's own
flatpak-external-data-checker open the update pull requests.

## Snap Store

`snap/snapcraft.yaml` unpacks the `.deb` (`source-type: deb`) and stages nothing
of its own: the `gnome` extension's platform snap carries GTK, WebKitGTK 4.1 and
libsoup3, and binds the `webkit2gtk-4.1` helper directory in from there. A staged
second copy of the library would pair a WebKit UI process with web process
helpers from a different WebKit, which is how a Tauri window ends up blank.
Strict confinement: documents arrive through `home` and `removable-media`, and
nothing else is needed.

Worth doing because Ubuntu's App Center is the first place a great many Linux
desktop users look for software, and a snap is the only way to be in it.

### Steps to publish it - needs your account

`snapcraft` is Linux-only, so run these in WSL
(`sudo snap install snapcraft --classic`) or on any Linux box.

1. Make an Ubuntu One account at <https://snapcraft.io/account> if you have
   none, then `snapcraft login`.
2. Claim the name - it is unregistered today:

   ```
   snapcraft register nib
   ```

3. Export credentials scoped to that one snap and hand them over:

   ```
   snapcraft export-login --snaps nib \
     --acls package_access,package_push,package_update,package_release \
     snapcraft-creds.txt
   gh secret set SNAPCRAFT_STORE_CREDENTIALS --repo lxorb/nib < snapcraft-creds.txt
   rm snapcraft-creds.txt
   ```

4. `gh workflow run publish-linux.yml --repo lxorb/nib -f tag=v0.4.0` uploads
   both architectures to the stable channel.

The first upload of a graphical snap goes through a manual review if it asks for
anything unusual; this one does not, so it should pass automatically.

## Nix

`nix/flake.nix` wraps the AppImage with `appimageTools.wrapType2`, which is the
short path for a Tauri app: the AppImage already carries WebKitGTK and its web
process, so nothing has to be patched in. The desktop entry and icons are
installed alongside, so it shows up in a launcher rather than only on `$PATH`.

This is deliberately not a nixpkgs package. nixpkgs wants a maintainer who
watches the build, and search.nixos.org is the only place a nixpkgs entry would
be more discoverable than this flake - a small audience for a large standing
commitment. The flake costs nothing and works today:

```
nix run github:lxorb/nib?dir=packaging/nix
nix profile install github:lxorb/nib?dir=packaging/nix
```

There is no `flake.lock` on purpose: pinning nixpkgs here would mean an extra
commit every time the pin went stale, and the package is one `fetchurl` and a
wrapper.

## Refreshing all of it for a new release

`publish-linux.yml` rewrites the version and the checksums in flight, so a
release publishes itself and nothing here has to be edited first. The files do
stay pinned to the last release they were checked against, though, which is what
makes the validation workflow meaningful. To move them forward by hand:

```
version=0.5.0
base=https://github.com/lxorb/nib/releases/download/v$version
for a in x64 arm64; do curl -fsSL "$base/Nib-$version-linux-$a.deb" | sha256sum; done
for a in x64 arm64; do curl -fsSL "$base/Nib-$version-linux-$a.AppImage" | sha256sum; done
```

- `aur/nib-bin/PKGBUILD`: `pkgver`, both `sha256sums_*`. Regenerate `.SRCINFO`
  with `makepkg --printsrcinfo > .SRCINFO`, or let the validation workflow print
  it - it fails if the committed one is stale.
- `flathub/ch.emilvinu.nib.yml`: the two URLs and their `sha256`, plus a
  `<release>` entry in `ch.emilvinu.nib.metainfo.xml`.
- `snap/snapcraft.yaml`: `version` and the two URLs.
- `nix/flake.nix`: `version` and both hashes, as SRI - `nix hash convert --hash-algo
  sha256 --to sri <hex>`.
