# Design

What the shell is held to: an honest look at where it stands against the apps
people already know, and the system it is being brought onto. The editor is not
the subject here - it is the part that already works. The subject is everything
around it: the rail, the list panel, the tabs, the bars, and the layers that
open over a note.

The before pictures this reads from were taken with
`apps/desktop/test/e2e/shell.py`, which serves the built web app and drives it in
the machine's own Chrome as a desktop in both schemes, as a tablet either way up
and as a phone. They are under `apps/desktop/test/e2e/shots/shell-before/`, which
is ignored; the names appear in the text.

## What the others do better

### Notion

**It names the place first.** The sidebar opens with the workspace icon, the
workspace name in semibold, and the account under it - so the panel has a
subject before it has a list. Everything below is understood as being about
that place.

**It labels its sections.** `WORKSPACE`, `SHARED`, `PRIVATE`, in 11px uppercase
with letters spaced out and the colour dropped to muted. A long list stops being
a wall: the eye lands on the label and reads the group under it.

**It fills the row you are on.** The selected page is a light grey rounded
rectangle across the full width of the panel. You never look for where you are.

**Its marks are the size of its words.** 18px icons against 15px names. The mark
reads as the first column of the row rather than as dust in front of it.

**Its verbs are in the panel.** Quick Find, All Updates, Settings sit as rows at
the top, with the same icon size and the same row height as the pages below
them. What you can do is in the same grammar as what you can open.

### Obsidian

**Every panel is the same panel.** One header height, one icon size, one hover
surface, one row height, whether it is the file list, the tag pane, the outline
or the backlinks. Density is not the trick - consistent density is.

**Two levels of text, and no more.** Normal and muted. The accent is spent on
links and the one active node in the graph, and nowhere else, so when it appears
it means something.

**Its rows have three columns.** A mark, a name that gives way, and a count or a
control pushed to the right. The tag pane's counts sit in that third column, so
the names still read as a column of their own.

### Discord, on a phone

**The rail is identity.** Round 48px avatars, and the one you are in marked by a
small white pill against the left edge - a marker beside the shape rather than a
recolouring of it.

**The panel has a real head.** The server name in bold 20px with a chevron that
says it can be acted on, a muted line under it, and then a full-width rounded
search pill. Identity, then the one action available everywhere, then the list.

**Three row states, clearly apart.** Read is muted, unread is bright and bold
with a dot at the left edge, selected is a filled rounded rectangle. You can
tell them apart at a glance and without reading a word.

**Categories in capitals.** `CHAT`, `PLANNING`, `VOICE CHANNEL` - the same trick
Notion uses, on a screen where it matters more.

## What nib gets right

The editor. `desktop-light-files.png`: the measure, the heading scale, the
padding, the syntax characters bleeding in as they are typed. Nothing in this
pass touches it.

The two systems that already exist and are already enforced. Motion is one
vocabulary of durations and easings in `tokens.css`, and every surface reads it.
The touch scale is one set of numbers, and `touch-scale.test.ts` refuses a
component that writes a finger-sized number of its own. That instinct - state it
once, then guard it - is the right one, and this pass extends it rather than
inventing a second way.

The structure. One document at a time on a handheld, the sidebar as a drawer
over the note, and a panel that is a place with a name at the top of it. That is
Discord's structure, and it is the correct one for what nib is - all of it
except the rail, which is where a place with a hundred servers keeps its
identity and nib has three spaces. See "The rail is gone".

## What nib gets wrong

**The list panel has no subject.** `desktop-light-files.png` and
`phone-files.png`: four unlabelled icon tabs float in the top-left corner, and
under them the tree begins. Nothing on the panel says which space you are in.
The bookmark row above the divider reads as a title and is not one. Notion's and
Discord's first move - name the place - is simply missing.

**Nothing can be searched from where you are.** Search is one of four icons that
look like the other three. Discord gives it a pill under the header because it
is the one thing you can always do; nib buries it in a tab strip with no labels.

**The marks are too small, and Emil is right about it.** 13px marks at 0.75
opacity beside 12.5px names. Notion is 18 against 15, Obsidian 16 against 13.
nib is the only one of the three where the mark is smaller than the word it
belongs to and faded on top of that. In `phone-files.png` the rows are 56px tall
and the mark inside them is 15px, which is a thumb-sized row with a pointer-sized
mark in it.

**No row is ever filled.** The open note is bold text and an accent-coloured
mark. In `desktop-dark-files.png` that is nearly invisible. All three references
fill the row; nib is the only one that does not, on the surface people look at
most.

**Six lists, six rows.** `Tree.svelte`, `Bookmarks.svelte`, the outline in
`Sidebar.svelte`, `TagTree.svelte`, `SearchPanel.svelte` and `Links.svelte` each
declare their own `padding: 4px 8px; border-radius: var(--radius-sm); font-size:
var(--text-sm)`, and between them use three different hover colours and four
different heights. Each was reasonable on its own. Together they are why the app
does not feel like one object - and the same six then repeat themselves under
`[data-touch]`, so there are twelve copies of one row.

**Two pluses, one drawing, two meanings.** `desktop-light-files.png` has a `+`
in the rail (new space) and a `+` in the tab strip (new note), forty pixels
apart, drawn identically.

**The rail's foot is a pile.** An account glyph, a moon, and a filled GitHub
silhouette among line drawings, at the bottom of a column that is otherwise
about spaces. The source link is already in the Help menu.

**The two columns across the top do not line up.** The title bar is 38px; the
panel's tab row is a 24px button in 12px of padding. Two rows across the top of
one app, at two heights, with no rule under either.

**The tables are the heaviest thing on the page.** `desktop-dark-table.png`: a
full grid at `--line-strong` in a document whose rules, blockquote bars and code
borders are all hairlines.

**Section labels exist in one place only.** `Links.svelte` has them.
`Bookmarks.svelte`, the tree and the search results do not.

**Half the drawer is empty.** `phone-files.png`: seven rows and then four
hundred pixels of nothing, under a rail whose bottom third is three unrelated
icons. Discord fills the same space with a header, a search pill and categories.

## The system

One vocabulary, stated in `packages/themes/src/tokens.css`, read by every
surface. Every name that was there before is still there; what is new is
additive and defined in terms of what already existed, so a registry theme that
overrides `--surface-2` or `--item-hover-bg-color` moves the new tokens with it.

### Spacing

`--space-1` … `--space-7` = 4, 8, 12, 16, 24, 32, 48. Nothing in the shell uses
a padding that is not one of these or a token built from them.

### Type

Four sizes in the chrome, and the document's own on top of them.

| Token | Size | What it sets |
| --- | --- | --- |
| `--text-xs` | 11px | section labels, counts, keys, second lines |
| `--text-sm` | 12.5px | meta beside a name |
| `--text-row` | 13.5px | **new** - the name in any row: tree, menu, palette, tab |
| `--text-base` | 15px | a sheet's title, a field over a list |
| `--text-head` | 15px | **new** - what a bar across the top of a column is titled with: the space's name over the list, the note's name over the page. 19px under a thumb, so a header is a step above the rows under it on either kind of screen |
| `--text-content` | 16.5px × zoom | the note |

Two emphasis levels and no more: `--weight-row` (450) for a row at rest,
`--weight-strong` (600) for a header or the row you are on. Colour carries the
same two levels: `--muted-strong` at rest, `--text-strong` when it is the thing.
The accent is spent on links, on the mark of the open note, and on the active
space. Nowhere else.

On a touch screen `--text-row` becomes `--touch-text` (17px). That is one
declaration in the tokens, not one per component.

### Icons

One size per context, so a glyph's size says what kind of thing it is.

| Token | Size | Where |
| --- | --- | --- |
| `--icon-sm` | 13px | a mark inside a row that is not the row's own: a tab's kind, a bookmark's kind |
| `--icon-md` | 16px | **the mark in front of a name** - tree, bookmarks, tags, menus, and the drawing inside a space's badge, which is a mark in front of a name too |
| `--icon-lg` | 18px | a glyph that is a button: panel tabs, title bar, the panel's foot |

On a touch screen `--icon-md` becomes `--touch-mark`, raised from 15px to 20px,
and `--icon-lg` becomes `--touch-icon` (24px). The mark is then within three
pixels of the 17px words beside it, which is the proportion Notion and Obsidian
both hold.

A space's badge and the face in the panel's foot are `--row-height-sm` square
with a corner a third of their side, so they are the same shape at 24px under a
pointer and at 48 under a thumb, and neither needs a size of its own.

### Rows

| Token | Desktop | Touch |
| --- | --- | --- |
| `--row-height` | 28px | `--touch-row` (56px) |
| `--row-height-sm` | 24px | `--touch-target` (48px) |
| `--row-pad` | 8px | `--touch-pad` (14px) |
| `--row-gap` | 8px | `--touch-gap` (12px) |
| `--row-indent` | 14px | `--touch-indent` (18px) |
| `--radius-row` | 6px | 10px |

`--row-height-sm` is for a list that is read more than it is tapped: the
outline, and a line of a search result. Everything else is `--row-height`.

The row itself is drawn once, as `.nib-row` in `base.css`, with three parts: a
`.nib-row-mark` of exactly `--icon-md`, a `.nib-row-label` that is the only part
allowed to give way, and an optional `.nib-row-meta` pushed to the far end. No
component draws that row again; a component may say how far a row is indented and
how wide it is in the space it sits in, and nothing else.

### Header rows

`--header-height` is `--titlebar-height` (38px), and it is what the title bar,
the panel's header, and the tab strip are all as tall as, so the two columns
across the top of the app read as one row. On a touch screen it is
`--touch-row`.

### Swapping

Changing what a surface is showing is a move, not a cut. Four tabs across the
top of the list panel that switch between two frames read as a flicker: nothing
says the new list came from anywhere, and nothing says the old one went. So
every swap in the app is one mechanism, `apps/desktop/src/lib/slide.ts`, beside
the durations in `motion.ts`:

- **`arrive` and `leave`**, a pair of transitions. What is going slips 6px up as
  it fades; what is coming comes up from 6px below. One helper with the distance
  as its argument, so a list dropping out of a header comes *down* out of it by
  passing a negative one.
- **`segmented`**, an action on the groove of a segmented control. It draws one
  raised surface, measures whichever button wears `on`, and slides the surface
  there - one element translating, rather than a background switching off under
  one half and on under another. It watches the class rather than being told a
  value, so it follows a choice made from a menu, a key or the palette as
  faithfully as one made by pressing the control, and no control passes it
  anything.

Two rules hold for both, and for anything added beside them:

**Transform and opacity only.** Never a width, a height, a top or a margin. Both
of these are laid out once and moved by the compositor after that, so a swap
costs no layout on any frame. Where two things have to cross, they are stacked -
the panel's body is `position: absolute` inside a positioned `.stack` - rather
than allowed to sit one above the other and shove the page around.

**Never in front of the interaction.** What was pressed is chosen on the frame it
was pressed; the movement catches up afterwards. Nothing waits for a transition
to end before doing what it was asked.

Reduced motion needs no second answer: the transitions take their duration from
`dur()`, and the sliding surface takes `--dur-fast`, which the tokens zero along
with every other duration. For a reader who has asked for as little movement as
possible, everything here is simply already where it is going.

What this reaches: the four panel tabs and the panel under them, on a desktop
and in the drawer alike; the settings sheet's segmented controls, and its panes,
which come up from below where they used to appear (and, on a phone, where they
used to do nothing at all); the sharing sheet's link mode; the publishing
sheet's address; the LLM pane's client picker; and the space switcher, which
drops out of the header it belongs to and goes back into it.

Two things were looked at and left alone. The search results and the header menu
already move, in this vocabulary and at these durations. And the strip of tabs
over the note keeps its sliding underline but does not crossfade its content:
the editor holds a state per tab, so switching is not the document moving but
the document *being* another one, and `apps/desktop/test/e2e/swap-cost.py`
measures the swap at under a frame either way - so latency is not the argument.
The argument is that a pane you are about to type into should be solid the
instant the caret is in it.

### Radius, and the elevation model

Three corners, and a rule that says which:

- `--radius-row` for anything **inside** a panel: rows, pills, small buttons.
- `--radius-md` (9px) for anything that **floats over** the app: menus, the
  format bar, cards.
- `--radius-lg` (14px) for a surface that **replaces** part of the screen: the
  palette, a sheet.

Elevation follows the same three:

| Level | Shadow | Border | What |
| --- | --- | --- | --- |
| 0 | none | none | in a panel - surfaces only |
| 1 | `--shadow-sm` | none | raised out of a control it sits in: the chosen half of a segmented control, the tab you are on |
| 2 | `--shadow-md` | `--line-strong` | a small bar over the text: the format bar, a PDF's two actions |
| 3 | `--shadow-lg` | `--line-strong` | a layer over the app: a menu, the palette, a sheet, a space lifted to be moved |

A shadow above zero always comes with a hairline border, and nothing at zero has
both a border and a background.

### The surfaces a row wears

Four states, four tokens, one meaning each, and each defined from a token a
theme already overrides.

| Token | From | What it says |
| --- | --- | --- |
| `--surface-hover` | `--item-hover-bg-color` | the pointer is here |
| `--surface-press` | `--press` | the click landed |
| `--surface-selected` | `--active-file-bg-color` | this is the note you have open |
| `--surface-picked` | `--surface-3` | you picked this with Ctrl or Shift |

`--active-file-bg-color` moves from `--accent-soft` to a 16% mix of the accent,
which is what makes the filled row actually read. A theme that restates either
token keeps its own answer.

The open note is the filled one. In an app that shows one document at a time on
half its devices, which note you are in is the single most important fact the
list carries, and the three references all spend a filled row on it.

### Alignment

One left edge per panel, at `--row-pad` from its side. The header's words, the
search pill, the section labels and every row's mark all start there, and every
name starts at `--row-pad + --icon-md + --row-gap`. A level of a tree adds
`--row-indent` and nothing else - no second indent for the mark, because the
mark's box is a fixed width whether it holds a folder's twist, a file's kind or
nothing.

### Section labels

`.nib-section` in `base.css`: `--text-xs`, uppercase, `0.06em` of tracking,
`--muted`, `--row-height-sm` tall, starting on the same left edge as the rows
under it. Every list that has more than one group wears it - bookmarks and files
in the tree panel, the two lists of links, a note's name over its search hits.

## What the shell becomes

### The list panel

Three rows of chrome, in the order identity, action, view - which is Discord's
order and Notion's:

1. **The header**, `--header-height`: the space's name at `--text-head` and
   `--weight-strong`, with a chevron beside the word rather than at the far end
   of the bar - the two are one control. Pressing it drops the list of spaces out
   of the header, inside the panel: the panel is the anchor, so the list is the
   width of the list of notes and there is nothing to measure, nothing to flip at
   an edge and no second sheet written for a phone. Where the panel is a drawer,
   the sidebar button stands in front of the name, because a drawer covers the
   bar that button otherwise sits in.
2. **The search entry.** One field, one mechanism. Outside the Search panel it
   is a pill that opens it; inside, it is the panel's own field, in the same
   place, at the same height, with the same radius and the same magnifier, drawn
   from the same `.nib-field` class. It is one control that becomes editable, not
   two controls that look alike.
3. **The panel tabs**, full width, one quarter each - the segmented control the
   settings sheet already uses, so the tab you are on is raised out of its groove
   exactly the way every other "this one" in the app is, and the raised surface
   slides between them rather than blinking; see "Swapping".

The tabs sit between the name and the search entry rather than under both: the
entry has to be in one place whether it is the pill or the field, and the field
belongs to the Search panel, which begins under the tabs. So the order on the
screen is name, tabs, entry, list - and the entry never moves.

### The rail is gone

There were two ways to choose a space, and the header's is the better one,
because it says the name. A column of wordless squares is only legible to
somebody who already knows the squares; the header says where you are before it
offers to take you elsewhere, which is the order Notion and Discord both put
identity in. So the column goes, on every device, and everything it carried has
a home:

| What the rail did | Where it is now |
| --- | --- |
| Which space you are in | The panel's header, and the title bar while the panel is shut |
| Switching to another one | Rows in that header's switcher, each with the space's own mark and a dot where somebody else is in it |
| Making one | A row at the foot of the same list, where a workspace switcher keeps it - and in the palette and the File menu, as before |
| A space's own menu | The same entries, on the space's own row: a button at the end of it, a right click, or a held finger |
| Reordering by dragging | `Move up` and `Move down` in that menu, on every device |
| The account | The left of the panel's foot row, as a face and a name |
| The theme, and settings with its sync light | The right of that same row |
| The three bars | The left end of the title bar, which is the corner of the screen they were already in |
| The sidebar button, where the panel is a drawer | The drawer's own head, which is the corner of the screen it was already in |

Two things are better for it rather than merely relocated. The switcher's rows
are rows - a mark, a name, a dot - so a space is read the way a note is, and a
space's name is never a tooltip that has to be hovered for. And the app now has
exactly one thing at the top left of the window on every device: the bars on a
desktop, the file list on a handheld, where the bar under a drawer would be
unreachable anyway.

What is lost is the marker against the edge, which said which space you were in
without a word. The filled row in the switcher says it instead, in the same
grammar as the note you have open - and the name is on the screen the whole
time, which the marker never was.

### The panel's foot

`--header-height` tall, so the list sits between two bars of one height, with a
hairline over it and the safe-area inset under it. Three things, and the same
three on every device, because it is one component: the account at the left as a
face and a name, opening the account pane - signing in, the name a shared space
shows, storage and signing out are all there, so who you are is one place rather
than a sheet here and a pane there; then the theme and the settings at the right,
where a switch goes. The theme is off while the theme in force has only the one
scheme. The settings button carries the sync light, as it did in the rail. The
GitHub mark does not come back: it is a row in Help.

### One plus

The plus always makes a note, and there is never more than one on screen. On a
desktop it is at the end of the tab strip, where a browser puts it. On a handheld
there is no tab strip, so it is at the end of the panel's header, where Discord
puts it.

### Tabs and bars

The tab strip and the title bar are `--header-height`. A tab's name is
`--text-row`, its mark `--icon-sm`, and the active tab keeps its sliding
underline. The status bar is unchanged: it is already the right idea - nothing
until it is looked at.

### Tables

Hairlines: `--table-border-color` drops from `--line-strong` to `--line`, and
the one rule left worth reading is the one under the header, which keeps
`--line-strong`. The grid recedes to what it is for - keeping the columns apart -
and the words in the table become the darkest thing in it. The same three lines
dress the table in the editor, on paper and on a published page; see
`editor.css`.

### On a phone

Modelled on Discord, because the structure is already the same - minus the rail,
which Discord earns and nib does not:

- The drawer is the list panel, the whole width of the screen, with the same
  four rows the desktop has at the touch scale: the head, the tabs, the search
  pill, the list, and the foot under them.
- The head carries the sidebar button, then the space's name and its chevron,
  then the one plus. The button is the same component the title bar has, in the
  same corner of the screen, so the top left means one thing whether the drawer
  is open or shut.
- **No bottom bar.** Discord earns one because it has three unrelated app-level
  places: servers, notifications, and you. nib has one place - your notes - and
  the other two candidates are already where they belong: search is the pill at
  the top of the list, and "you" is the first thing in the panel's own foot. A
  bar of three tabs where one is always selected would spend 56px of a phone
  screen and a permanent line of chrome to move two rarely-pressed things one tap
  closer, and it would put a second navigation model beside the drawer that
  already navigates. For a notes app it is bloat. It is not built.
- The document does not peek from the right. One document at a time, the drawer
  over it, the sidebar button at the top left and the three dots at the top
  right, all unchanged.

## What is guarded

`apps/desktop/test/touch-scale.test.ts` already refuses a component that writes
a finger-sized number of its own. It gains two things: the raised
`--touch-mark`, and a check that the row scale is restated from the touch scale
in one `[data-touch]` block in the tokens rather than per component.

`apps/desktop/test/one-of-each.test.ts` already refuses a second copy of a shared
control. It gains the row: `.nib-row` is drawn in `base.css` and nowhere else,
and no list paints a hover or a press of its own.
