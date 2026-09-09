# Nib on a phone

The same app, the same crate and the same notes, built as a native Android and
iOS app with Tauri 2. Nothing about it is a separate product: the phone layout,
the drawer, the sheets and the docked formatting bar are the ones the web build
already has on a small screen, and the notes are the same files under the
documents folder that the desktop reads.

## Identity

One identity across every build, from `src-tauri/tauri.conf.json`.

| | |
| --- | --- |
| Bundle identifier | `ch.emilvinu.nib`, which is also the Android package name |
| Name | Nib |
| Publisher | Emil Vinu |
| Icons | `src-tauri/icons/android` and `src-tauri/icons/ios`, from `tauri icon` |
| Minimum Android | API 24, and API 36 is what it is compiled against |
| Minimum iOS | 14, which is Tauri's default |

The launch screen on Android is the window's own background, set in
`res/values/themes.xml` to the page's `--bg` in light and dark, so a cold start
shows the colour the app is about to paint rather than a white flash.

## What is built, and where it goes

`.github/workflows/publish-mobile.yml`, on every push to main and on every tag
`v*`, the way `release.yml` builds the desktop.

- **Android**, on `ubuntu-latest`: `tauri android build --apk` for
  `aarch64-linux-android` and `x86_64-linux-android`. The APK is signed, always,
  because an unsigned one will not install.
- **iOS**, on `macos-latest`: `tauri ios init`, then a build for the simulator.
  It does not run on a phone: that needs an Apple developer account, which there
  is not one of yet. The library is compiled for the device target beside it, so
  the part that could break is still built.

A tag puts all of them on that version's own release, beside the desktop
installers. A build of main goes on a rolling pre-release called `mobile-edge`,
not the desktop's `edge`, because `release.yml` deletes and remakes that one on
every push and would take an APK uploaded beside it with it.

## Installing the APK on a phone

1. Open the [`mobile-edge` release](https://github.com/lxorb/nibeditor/releases/tag/mobile-edge)
   in the phone's browser and download `Nib_<version>_android-universal.apk`. It
   carries both architectures, so it is the right file for any phone and for an
   emulator; it is around 19 MB.
2. Tap the download. Android asks once whether this browser may install apps;
   allow it, which is the "Install unknown apps" permission for that browser
   under Settings, Apps.
3. Play Protect will say it does not recognise the app. Install anyway.

Every build of main is signed with a key the workflow generates for that run, so
Android sees each one as a different app and refuses to install it over the last.
Uninstall the old one first, or add the release keystore below, after which every
build replaces the one before it. The version code comes from the version number
rather than from the build, so two builds of the same patch share one; that is a
reinstall, which Android allows, and only a lower one is refused.

Nothing on the phone updates itself: the desktop app has an updater, the phone
app does not, because a store is what does that and there is no store account.

## What device signing needs later

**Android, a key that does not change.** Make one keystore, keep it forever,
losing it means a new app identity:

```sh
keytool -genkeypair -v -keystore nib-release.jks -alias nib \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then three repository secrets: `ANDROID_KEYSTORE`, the file as base64
(`base64 -w0 nib-release.jks`), `ANDROID_KEYSTORE_PASSWORD`, and
`ANDROID_KEY_ALIAS`. The workflow already uses them when they are there and
falls back to a throwaway key when they are not, and `app/build.gradle.kts`
reads them out of a `keystore.properties` the job writes and never commits.
Nothing else changes.

**iOS, an Apple developer account.** With one:

- Add the team to `tauri.conf.json` as `bundle.iOS.developmentTeam`, or pass it
  as `APPLE_DEVELOPMENT_TEAM`. The workflow passes a placeholder today, which is
  only a field being filled in for a build that signs nothing.
- Register `ch.emilvinu.nib` as an App ID, and make a distribution certificate
  and a provisioning profile for it.
- Add `APPLE_CERTIFICATE` (the `.p12` as base64), `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_PROVISIONING_PROFILE` and `APPLE_DEVELOPMENT_TEAM` as secrets, import
  the certificate into a keychain in the job, and replace the two steps that
  build for the simulator and the device with one
  `tauri ios build --target aarch64 --export-method release-testing`, which
  produces the `.ipa`.

  There is no unsigned archive today because there cannot be one. Xcode's
  archive refuses to codesign without a certificate, and running `xcodebuild`
  by hand does not work either: the project's Rust build phase asks the Tauri
  CLI that started it for its options over a local socket, so only the CLI can
  drive that build.
- TestFlight or the App Store then needs an App Store Connect API key
  (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) and an upload step.

## What is committed and what is generated

`src-tauri/gen/android` is source. Its manifest, its theme, its colours, the two
files under `res/xml` and `MainActivity.kt` are edited by hand, and everything
gradle writes inside it is ignored by the project's own `.gitignore`, along with
the `tauri.*` gradle files the CLI rewrites on every build.

`src-tauri/gen/apple` is not committed. The CLI only writes it on a macOS
machine, and nothing in it is edited, so there is nothing a commit would
preserve that `tauri ios init` does not produce again. The iOS job runs that
first.

Run `tauri android init` again through the package manager, as
`pnpm --filter @nib/desktop exec tauri android init`, never as `node` and a path
to the CLI. The gradle task that builds the crate is generated with whatever
command started the CLI written into it, so the second way bakes one machine's
node into the project and the build then works nowhere else. Compare
`buildSrc/.../BuildTask.kt` after, and put the hand-edited files back.

## What Android may copy out of the app

Nothing. `android:allowBackup="false"` keeps the notes out of the Google Drive
backup, and `res/xml/data_extraction_rules.xml` keeps them out of the transfer to
a new phone as well, which from Android 12 some manufacturers make whatever
`allowBackup` says. Notes are the most private thing the app holds and none of
them is state a new install needs, so the reader carries them across themselves,
by sync or by file.

`res/xml/file_paths.xml` is the other half of the same rule: it names the folders
Nib may hand another app a file out of, and those are Nib's own. Tauri's template
names the root of shared storage instead, which would offer every photo and
download on the phone under Nib's authority.

## One size for a finger

A phone is not a narrow desktop. Everything a thumb lands on is sized from one
scale in `packages/themes/src/tokens.css`, and only rules under `[data-touch]`
read it, so a desktop keeps the sizes it has always had.

| | | |
| --- | --- | --- |
| `--touch-row` | 56px | a row in a list, and the app bar |
| `--touch-target` | 48px | a square that is only a button, and a row read more than tapped |
| `--touch-text` | 17px | the words in a row |
| `--touch-icon` | 24px | an icon that is a button of its own |
| `--touch-mark` | 15px | the slot a mark beside a row's words is drawn in |
| `--touch-gap` | 12px | between a mark and the words |
| `--touch-pad` | 14px | a row's own side padding |
| `--touch-indent` | 18px | one level of a tree |
| `--touch-bottom` | | what a sheet leaves under its last row, over the gesture bar |

`apps/desktop/test/touch-scale.test.ts` holds every component to it: a touch rule
that writes a finger-sized number of its own fails.
`apps/desktop/test/e2e/touch-scale.py` measures what that comes to on a phone, a
tablet held both ways and a desktop, and photographs each light and dark.

## Which device this is

The machine decides, and the width only tells a phone from a tablet. A window is
not a device: a reader who ticks "Desktop site" is asking for the desktop app
however small their screen is, and a desktop window dragged narrow is still a
desktop. `deviceFor` in `apps/desktop/src/lib/viewport.svelte.ts` is the whole of
it, and it reads four things - the build, `navigator.userAgentData.mobile`, the
user agent, and whether the primary pointer is a finger
(`(hover: none) and (pointer: coarse)`).

A browser has to say it is a handheld *and* have the glass under a finger. Both
halves are needed: the user agent alone is what a developer's device toolbar
fakes, and a coarse pointer alone is a desktop with a touch screen.

| What is running it | Says it is mobile | Finger | Device |
| --- | --- | --- | --- |
| The Android or iOS build | not asked | not asked | `phone` under 500pt on its narrow side, else `tablet` |
| Chrome or Safari on a phone | `Mobile` in the user agent, `mobile: true` | yes | `phone` |
| Chrome on an Android tablet | only `Android`; `mobile: false` | yes | `tablet` |
| Safari on an iPad | only `Macintosh`, since iPadOS 13 | yes | `tablet` |
| A phone browser with "Desktop site" ticked | nothing: the tick rewrites the string | yes | `desktop` |
| A desktop browser, window dragged narrow | nothing | no | `desktop` |
| A desktop with a touch screen | nothing | either | `desktop` |

Two of those rows are worth saying out loud. `Macintosh` counts as a handheld
because an iPad calls itself one and no Mac ever answers the pointer query with a
finger - a Mac has a trackpad, which hovers. And because iOS says `Macintosh`
either way, a *phone* on iOS asked for the desktop site lands on the tablet
layout rather than the desktop one: Safari there leaves nothing behind to tell an
iPhone from an iPad. On Android, which is where the tick is worth having, it
works exactly as the checkbox suggests.

`data-narrow` is still the width and nothing but the width (460px and under), so
any layout that depends on how much room there is can read it. It says nothing
about the device: the rules that turn the drawer into the whole screen ask for
`[data-drawer][data-narrow]`, so a narrow desktop window keeps its columns.

`apps/desktop/src/lib/viewport.test.ts` covers every row of that table, and both
halves of the pair on their own.

## The row along the top

Three things, in the order a thumb reaches them.

| | |
| --- | --- |
| Left | The button that opens and shuts the file list - `SidebarToggle.svelte`, the same one the desktop title bar has, with the panel's edge sliding out of the window as the list arrives |
| Middle | The document's name, with the mark its kind wears in every list that shows it |
| Right | Three dots, which open the menu the desktop's menu bar holds: the same groups, the same rows, the same submenus, as one sheet - `AppMenu.svelte` with `dots` |

There is no hamburger on a phone or a tablet. The rail's menu button is the
desktop's; where the sidebar is a drawer the rail carries the sidebar button
instead, because a drawer over the note covers the bar that button otherwise sits
in and the top left of the screen should mean the same thing either way.
`apps/desktop/test/mobile-header.test.ts` holds the row to all of that.

## One document at a time

A phone and a tablet hold one document, and one pane. A strip of tabs on a
screen that narrow says less the more it holds, so opening a note, a canvas or a
paper puts away the one that was there rather than standing it beside it, and
the title bar is that document's name and mark instead of a strip. There is no
plus, no dragging a tab, and no dragging a pane into being; a desktop keeps all
three.

Nothing is lost in the trade. What was open goes on the closed stack with its
words (`workspace/closed.svelte.ts`), so back - the gesture on Android, `Reopen
closed tab` everywhere - walks back along the line of documents, and each step
puts the one on screen on the stack in its turn. A note in a space was written
down before it was closed anyway: the account has it whatever this window shows.

`workspace.oneDocument` is where the rule is applied to an arrangement that
arrives from somewhere else - a session written on a desktop, a saved layout, a
window that has just become one of these devices - and `onlyOne` is the rule
itself, on every way a document opens. `apps/desktop/src/lib/one-document.test.ts`
holds both to it, and holds the desktop to keeping every tab it has always had.

## The two things a phone needs that a desktop does not

**The keyboard.** The window draws under the system bars, so Android does not
shorten it when the keyboard opens and the line being written would sit behind
the keys. `MainActivity.onWebViewCreate` pads the webview by the keyboard's
height instead, which ends the page where the keys begin. The page reads that as
a window that has lost height rather than as a keyboard over it, which is why
`viewport.svelte.ts` has both `keyboard`, the pixels covered, and `typing`,
whether the keyboard is up at all. In a browser only the first is ever non-zero;
in the app only the second. The caret is scrolled back into sight from
`App.svelte` on each step of the keyboard's arrival.

**Back.** Every layer the app opens over a note takes a history entry
(`backstack.svelte.ts`), so back should close the newest one rather than leave
the app. `MainActivity` turns `handleBackNavigation` on, which is what makes the
webview answer a back press while it has somewhere to go back to and finish the
activity when it does not.

## What the phone build does not have

Half the app is about a desktop, and none of it is compiled in: no updater, no
second window, no file dialog, no PDF printing, no pandoc, no Reveal in the file
manager, no Explorer New menu, no file associations. The Rust modules behind
those are `#[cfg(desktop)]`, their commands reach the handler only there, and
`capabilities/mobile.json` grants nothing for a plugin that is not in the build.
There is a test on that, in `test/permissions.test.ts`.

Three more are left out on purpose.

- **Sharing a note to another app.** Tauri has no share sheet plugin, so this
  would be a plugin of our own on both platforms. Publishing a note through the
  sync service already gets it out of the app.
- **Opening a `.md` shared into the app.** Android hands over a `content://`
  URI, not a path, and nothing in the crate can read one. It needs an intent
  filter and Kotlin to copy the bytes across.
- **Export to a file.** The webview has no download handler, so the browser
  build's blob download does nothing there. Publishing is the way out for now.

Clippy is run for `aarch64-linux-android` and `aarch64-apple-ios` in the mobile
workflow rather than in `check.yml`, because both need a cross toolchain that
only those jobs set up.

## Locally

```sh
# Android, with ANDROID_HOME and NDK_HOME set and a device or emulator attached
pnpm --filter @nib/desktop exec tauri android dev

# iOS, on a Mac
pnpm --filter @nib/desktop exec tauri ios init
pnpm --filter @nib/desktop exec tauri ios dev
```

A release APK built by hand is unsigned, because there is no
`gen/android/keystore.properties` on a development machine. `tauri android dev`
signs with the debug key and installs fine.
