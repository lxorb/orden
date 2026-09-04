# Settings, menu and publishing: design

Ten items arrived together on 2026-09-04. They share one surface, the
settings sheet, so they are designed here as one piece of work.

1. Settings feel bad on a phone. Redo them so they are made for one.
2. The hamburger menu is unusable on a phone.
3. An unpublished subdomain (`unused.nibeditor.com`) should send the visitor
   to `nibeditor.com`.
4. Settings open on General.
5. Publishing offers a `nibeditor.com` name *or* a domain of your own, never
   both, and the choice is plain to see.
6. An account can carry a display name, shown on what it publishes.
7. The Export pane looks like it belongs.
8. Dropdowns match the theme, including the highlighted row.
9. Settings search finds any text in settings.
10. The theme follows the system unless told otherwise.
11. The sidebar toggle looks pressed after a swipe on a phone.

## Settings on a phone

The desktop sheet stays a two-column window: the list of panes on the left,
the pane on the right. A phone gets the pattern every phone user already
knows: a full-screen page listing the panes, and tapping one slides that pane
in from the right with a back button in its header.

**State.** `settings.listing` says whether the list is showing rather than a
pane. `settings.show()` with no section lands on the list on a phone and on
General on a desktop; `show('publish')` opens that pane straight away, with
back leading to the list. A desktop ignores `listing`.

**Back.** The Android back button and the header's back button do the same
thing: pane → list → closed. Each level is its own layer in the back stack.
Two layers can close at once (the close button in a pane), and
`history.back()` is asynchronous, so `BackStack` counts the entries it has
given back but not yet been told about, instead of checking which entry is
on top. That count is what keeps the browser history and the open layers in
step.

**Layout on a phone.**

- The sheet fills the screen, background `--bg`, safe areas respected, and
  slides up on opening.
- A 52px header: back (when in a pane), the title, close.
- The list: the search box, then the panes as inset grouped cards -
  preferences, account things, export - each row 52px with its icon, its
  name and a chevron.
- A pane: group captions above inset cards. Rows are 52px, 15px text,
  hairline separated. A switch row is one button, the whole width of it.
  A slider row wraps: name and value on the first line, the slider full width
  beneath. A dropdown row shows its value on the right.
- Inputs are 16px on a phone so iOS does not zoom into them. Switches are
  50×30, slider thumbs 24px, swatches 36px, buttons full width and 48px.

**Search.** On a phone the results replace the list under the search box; on
a desktop they replace the pane. Each hit is the setting with its control,
captioned with the pane it lives in. Hits from the hand-written panes
(Account, Publish, LLM access, Export) are rows that open that pane.

Search matches any text: the field's label, its group, its pane, the labels
of its options, and the strings the hand-written panes show. Plain
case-insensitive substring - settings are looked up by a word someone
remembers, not by initials.

**Controls.** `Field` rows are rendered by one snippet on both platforms.
Sliders are drawn by hand (a 4px track filled to the value, a white thumb)
so they look like the switches beside them. The Explorer "New" menu switch
becomes an inline `Field` so it shares the row.

## The menu on a phone

The hamburger stays where it is, at the top of the rail in the drawer. What
opens is a bottom sheet: a grip, the groups as wrapping chips (File, Edit,
Paragraph, Format, View, Help), and the chosen group's rows beneath, 48px
each, scrolling within 72dvh. Keyboard hints are hidden, a tick sits at the
trailing edge. The scrim dims. A desktop keeps the two-column popover.

## Dropdowns

The native `<select>` cannot be themed past its closed state: the list it
opens is the operating system's, and the highlighted row is whatever blue
that platform likes. A `Select` component replaces it wherever the app shows
one (settings, the prompt sheet's space picker):

- The trigger reads like the current control, and takes the same
  `value`/`options`/`onchange`.
- On a desktop it opens a listbox under the trigger (above it when there is
  no room), rows highlighted in `--accent-soft`, the chosen one ticked.
  Arrow keys move, Enter and Space choose, Escape and clicking outside close,
  typing jumps to a row.
- On a phone it opens a bottom sheet with the same rows at 48px.
- `role="listbox"`/`option` with `aria-selected`, and the trigger carries
  `aria-haspopup` and `aria-expanded`.

The global `select` rule stays for anything that still uses the element.

## Export pane

Two groups like every other pane. "Page" holds Paper, Orientation and Margin
as rows. "Export" holds the export actions as rows in a card - Export as PDF,
Export as HTML, Export as HTML without styles, Import a document when pandoc
is there - each the full width of the card.

## Publishing: one address

The pane asks one question about the address, with a segmented control:
**On nibeditor.com** or **Your own domain**. Only the chosen one's field
shows.

- Name: the name field with `.nibeditor.com` after it and the live
  availability check.
- Domain: the domain field, the DNS records to add once published, and -
  only when a name is currently live - a line saying that switching gives
  that name up.

Publish sends only the chosen address. The server makes the rule hold: a
domain clears the name, a name clears the domain, and neither at all is a
400 ("choose an address"). A request that changes only the note keeps
whatever address it had. The listing includes the DNS records so the pane
can show them again after a reload. "Live at" links to whichever address
is in use.

## Unpublished subdomains

The catch-all route already looks the host up. When nothing is found and the
host is a subdomain of `BLOG_ROOT`, it answers with a 302 to `APP_ORIGIN`.
The root itself and any other host keep serving the app. A private space's
name therefore forwards rather than 404s.

## Display names

- `users.name` (nullable) via migration `0008_user_name.sql`.
- `GET /v1/me` and the sign-in response include `name`. `PATCH /v1/me`
  with `{ name }` trims it, collapses whitespace, refuses more than 60
  characters, and stores an empty one as null.
- Published pages put the name in `<meta name="author">`, under the
  index heading as "by *name*", and in every page's footer before
  "Published with Nib".
- The Account pane has a Display name row (saved on change) above the email,
  captioned "Shown on anything you publish."

## Theme follows the system

`theme.id` gains `system`, the default. It resolves to the dark or light
built-in from `prefers-color-scheme`, live: a media-query listener updates
the resolved scheme, so a phone flipping to dark at night takes the app with
it. The Theme dropdown lists "Match the system" first. The rail's toggle
still jumps to the explicit counterpart scheme, which is what a one-tap
switch means.

## Sticky hover on touch

A touch that starts on the sidebar toggle - which is where a swipe from the
top-left corner starts - leaves the button in its hover style until the next
tap, because a touch browser emulates hover and never ends it. Hover styles
in the titlebar and the rail move under `@media (hover: hover)`, so a
pointer keeps them and a finger never sees them. The accent colour that
marks the toggle as "on" is a state, not a hover, and stays.

## Settings open on General

`settings.section` defaults to `general` and `show()` without a section
lands there (on a desktop). The fallback when a pane disappears on sign-out
stays Account, which is where "Not signed in" lives.

## Testing

- Worker (`services/sync`, vitest against real SQL): unpublished-subdomain
  redirect, root not redirected, either/or address rules, note-only updates
  keeping the address, no-address refusal, display name set/clear/too long,
  name shown on published pages.
- Desktop: `svelte-check` and existing unit tests. The layouts are checked by
  eye in Chrome at phone and desktop widths.

## Out of scope

Drag-to-dismiss on sheets, a swipe-back gesture in settings, and Cloudflare
for SaaS wiring for custom domains.
