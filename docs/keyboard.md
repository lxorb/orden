# The keyboard

Nib is meant to be usable with no pointer at all. Not "usable" as in you can Tab
through it if you are patient: usable as in a hand that never leaves the home row
can open a note, read down a folder, switch space, change a setting and get back
to writing.

This is what the keys do, region by region, and why each of them is that key.

## What the others do

Three apps worth copying from, and each of them answers a different question.

### Discord

The one with an actual model, and the closest thing to what a notes app needs.

- **A region is a named section**: server list, channel list, messages, member
  list. **F6 moves to the next one, Shift+F6 back.** That is the whole trick.
- **Tab moves between controls; arrows move within a list.** Lists are
  deliberately kept out of the tab order, and their docs say why: "these things
  can have hundreds of entries at a time."
- **Escape means step back out one level**, from a focused message to the chat
  box. It is also mark-as-read, which is the one thing not worth copying: an
  Escape that changes something is an Escape nobody can undo.
- **The focus ring is not a setting.** Press Tab and you are in "keyboard mode"
  and the ring appears. There is no toggle in their accessibility tab; the
  checked-for-it list has a saturation slider, high contrast, reduced motion and
  no keyboard entry at all.
- Ctrl+K quick switcher, Ctrl+/ for the key list, Alt+Up/Down between channels,
  Alt+Shift+Up/Down between unread ones, Ctrl+Alt+Up/Down between servers.

### Obsidian

No focus model at all, and it does not pretend to have one. Everything is a
**named command** found through Ctrl+P and bound in Settings. The commands to
move focus between panes exist (`editor:focus`, `editor:focus-top`) and **ship
with no key bound**. Both sidebar toggles ship unbound too. Getting the keyboard
into the file tree in the first place has no default key: you click.

What it does have is a good tree. Up and down move, left and right collapse and
expand, Shift extends the selection, Ctrl+Up/Down moves and opens as it passes,
F2 renames, Escape clears the selection only if there is one and otherwise falls
through. Ctrl+Tab and Ctrl+Shift+Tab go round the tabs, Ctrl+1 to Ctrl+8 jump to
one and Ctrl+9 jumps to the last.

Tab is not a navigation key there. All six places Obsidian binds it are
autocomplete popups; everywhere else it indents.

### Notion

Also no regions. The keyboard lives inside the page, and **Escape is the mode
switch**: from the caret it selects the block you are in, again and it clears.
Then arrows move the block selection and Ctrl+Shift+arrows move the blocks.
Tab and Shift+Tab nest and unnest. Getting around is search and history rather
than focus: Ctrl+P, Ctrl+[ and Ctrl+], Ctrl+Shift+U up a level.

Nothing about focus, focus rings, sidebar keys or Tab traversal appears anywhere
in their docs. Ctrl+backslash for the sidebar, which everybody repeats, is not on
their shortcuts page either.

### And the ARIA practices

The W3C's authoring practices say the same thing Discord does, in colder words:

- **One tab stop per composite widget.** Tab and Shift+Tab move between
  components; the arrows move inside one. Not every control gets a tab stop, and
  the ones that do not are reached from the one that does.
- **Roving tabindex**: exactly one row of a list carries `tabindex="0"` and the
  rest carry `-1`. On a key press the 0 moves and the row is focused, which also
  scrolls it into view for free.
- **Tab into a list arrives at the selected thing**, not at the top.
- A **tree**: right opens a folder and then steps into it, left closes one and
  otherwise steps out; Home and End; type a letter to jump to a name.
- **Tabs**: left and right with wrapping, Delete closes one, and choose on
  arrival only "as long as their associated tab panels are displayed without
  noticeable latency."
- A **dialog**: Tab wraps inside it, Escape closes it, and focus returns to what
  opened it.
- A **focus ring** must be at least 2px solid, at 3:1 against what is next to it.
  One pixel fails.

There is no standard for F6. It is a convention: Windows cycles a window's
elements with it, Chrome and Firefox move between their own panes with it, VS
Code has `focusNextPart` on F6 and `focusPreviousPart` on Shift+F6, and Discord
documents it as its section key. The APG has an open issue proposing Ctrl+F6 for
the same job and it has sat there since 2020.

## Nib's model

Four sentences.

1. **Tab moves between things, arrows move inside one.** Every list, strip and
   tab row in the app is one tab stop.
2. **F6 walks the regions, Shift+F6 walks them back**, and it works from inside
   the note, which Tab cannot because Tab indents.
3. **Escape steps back exactly one level and never does anything.** In a list it
   drops the selection first and then hands the keyboard to the note.
4. **The note is where people live.** Every road out of everywhere ends there.

### The regions

Seven, in the order the window draws them, which is the order Tab already walks:

| | |
| --- | --- |
| `space` | the sidebar's header, which is the space's name and its switcher |
| `panels` | the row of four panel tabs |
| `search` | the search pill under them |
| `list` | whichever panel is open |
| `tabs` | the strip of notes |
| `editor` | the note |
| `status` | the bar under it |

They are marked in the page with one `data-region` attribute each, so the order
F6 walks is the order the window is built in and cannot drift from it. What is
not on screen is not in the ring: the sidebar may be shut, a phone has no strip,
and a canvas has no status bar.

### In a list

Every `.nib-row` list in the app behaves the same way, because they all go
through one module. The file tree, the bookmarks above it, the outline, the tags,
the search results, the backlinks, the strip of notes.

| Key | What it does |
| --- | --- |
| Up, Down | the row before, the row after. The ends do not meet: falling off the bottom of a folder into its top loses your place |
| Left, Right | in a tree, close and open a folder; right on an open one steps into it, left on a closed one steps out to the folder holding it |
| Home, End | the top and the bottom |
| a letter | the first row whose name starts with it. Keep typing to narrow; a pause starts a new word |
| Enter | open it, and the note takes the keyboard |
| Space | open it and stay here, so a folder can be read down without leaving the list. Obsidian has the same idea on Ctrl and an arrow |
| Shift+F10, Menu | the row's own menu, the same one a right click gives |
| Delete | on the strip of notes, close the tab |
| Escape | drop the selection; with none, back to the note |
| Tab | out of the list entirely, because a list is one tab stop |

Two exceptions, both from the practices. The **panel tabs change as you arrive**
at them, because what each shows is already worked out and arrives without a
wait. The **strip of notes does not**: each of those is a file to read off a
disk, so an arrow moves and Enter opens.

Left and right are the arrows in a list that runs across (the strip, the panel
tabs), and those two leave up and down alone so the page underneath still
scrolls.

The file list is a list of buttons and not an ARIA `tree`. The roles were left
off on purpose: nib's markup puts a folder's children in a sibling of the row
rather than inside it, and a `tree` built that way announces worse than no tree
at all. The keys are the tree keys either way.

### The chords

Everything below is in the shortcut registry, so it shows in Settings, it shows
in the palette, and it can be rebound. What was already there is marked.

**Getting around**

| | |
| --- | --- |
| F6, Shift+F6 | next section, previous section |
| Ctrl+P | the palette. Type for a note, `>` for a command (already there) |
| Ctrl+O | open a file (already there) |
| Ctrl+Shift+? | every key there is, which is the Shortcuts pane in Settings |

**The panels**

| | |
| --- | --- |
| Ctrl+Shift+E | Files |
| Ctrl+Shift+O | Outline |
| Ctrl+Shift+F | Search (already there) |
| Ctrl+Shift+B | Links |
| Ctrl+Shift+L | show or hide the sidebar (already there) |

Each of the four opens its panel **and puts the keyboard in it**, and pressing it
again while the keyboard is already there gives the note the keyboard back. One
key there and one key back: the alternative is a key that opens something and a
second key nobody remembers for leaving it.

They are letters and not digits, and that is not taste. Ctrl+Shift and a digit is
not a key a text editor can spend: on a layout where the digit itself is the
shifted character, which is every AZERTY, CodeMirror reads the press as Ctrl and
the digit and sets a heading level. Ctrl+Shift+3 used to open the file list and
turn the line into a heading, both. A letter cannot be read that way round,
because the shifted letter and the letter are different names for the key.

The same rule caught one that was already there: Actual size was on Ctrl+Shift+0
and Ctrl+0 is Paragraph, so on those layouts it reset the zoom and flattened the
heading the caret was in. It is Ctrl+Alt+0 now, which is still the 0 every
browser resets with. `shortcuts.test.ts` fails if another one appears.

**The notes**

| | |
| --- | --- |
| Ctrl+Tab, Ctrl+Shift+Tab | round the strip (already there) |
| Ctrl+Alt+1 to 9 | the note at that place (already there) |
| Ctrl+W | close (already there) |
| Ctrl+Shift+T | reopen the last closed one (already there) |
| Ctrl+Alt+Right, Ctrl+Alt+Down | split (already there) |
| Ctrl+Alt+O | the other pane (already there) |

Under the Obsidian preset the digits move to Ctrl+1 to Ctrl+9, which is
Obsidian's own, and the heading levels give them up.

**The spaces**

| | |
| --- | --- |
| Ctrl+Shift+, | the space before |
| Ctrl+Shift+. | the space after |
| Ctrl+Shift+Space | the space switcher, from anywhere |

Discord switches servers with Ctrl+Alt and an arrow, which is the same shape of
thing. Here both of those arrows are the panes', so the two keys every app uses
for "the one before" and "the one after" take it instead. The switcher is on the
space bar because that is where the word is written, and it opens the sidebar
header's own menu rather than a second copy of it.

### Layers

Sheets, menus, the settings, the pickers, the palette. All of them:

- hold the keyboard while they are open, so Tab goes round the inside rather than
  off into the note behind, which is still full of buttons nobody can see;
- close on Escape, through one stack, newest first;
- **hand the keyboard back to whatever opened them.**

The palette is the exception to the last one, and deliberately: choosing in the
palette is how you arrive at a note, so it gives the keyboard to the note. It is
also a combobox now - the keyboard never leaves the box, the arrows move which
row it is pointing at, and the rows are out of the tab sequence, because forty
notes would otherwise be forty presses of Tab between the palette and the note
behind it.

### The ring

One token, `--focus-ring`, in `packages/themes/src/tokens.css`, and one rule in
`base.css` that puts it on everything a key can land on. Two pixels, solid, in
the accent, which is the thinnest ring WCAG counts and the one colour in the app
that carries 3:1 against every surface it sits on.

It is drawn on `:focus-visible` and never on `:focus`. That is the whole of what
Discord spends a mode on: a click leaves nothing behind, a key leaves the ring,
and the browser has known which of the two it was for years.

Thirty rules had their own copy of the same two lines before this, which is
thirty chances for one of them to be a different thickness. `one-of-each.test.ts`
now fails if a component draws its own.

### Not covered

The canvas and the Even glasses. The plane has its own keyboard already, one
letter per tool, and it is a drawing surface rather than a list of names; the
glasses have no keyboard at all. Touch is unaffected by every word above.

## Where the code is

| | |
| --- | --- |
| `apps/desktop/src/lib/regions.ts` | which regions there are and which one a step lands in. Pure, tested |
| `apps/desktop/src/lib/focus.ts` | the same, against the real page: what is on screen, where the keyboard is, how to put it somewhere |
| `apps/desktop/src/lib/roving.ts` | one tab stop per list, and the arrows inside it. Every `.nib-row` list uses it |
| `apps/desktop/src/lib/walk.ts` | where a press moves a cursor down a list of rows |
| `apps/desktop/src/lib/list-keys.ts` | spelling a name, shared by every list |
| `apps/desktop/src/lib/tree-keys.ts` | left and right in a list that holds lists |
| `apps/desktop/src/lib/trap.ts` | a layer holds the keyboard and hands it back |
| `apps/desktop/src/lib/shortcuts/registry.ts` | every chord there is |
| `apps/desktop/test/e2e/keyboard.py` | the whole thing driven with nothing but `page.keyboard` |
