# The canvas

An endless plane with cards, frames, connectors, shapes and ink on it, in a tab
like a note. The file is [JSON Canvas](https://jsoncanvas.org), the same one
Obsidian writes, with the ink and the shapes under a `nib` key that any other
reader ignores. Several devices can be on one plane at once; see
[collaboration.md](collaboration.md).

This is the interface, and why it is the one it is. Two apps were read closely
first, because between them they are what everybody arrives already knowing: a
tablet with a pen behaves like Samsung Notes, and a board with cards on it
behaves like Miro.

## Samsung Notes

**What it does nicely.** It is pen first and it never asks a question a hand
cannot answer while it is writing. Everything is in one bar across the top: the
five instruments, three colours, the width of the line drawn as that width, undo
and redo. Nothing is nested that a hand reaches for mid sentence.

The gesture that carries the whole app is pressing the tool you are already
holding: it opens that tool's own options and nothing else. Nobody has to be
told, because a pen out of a pot and a pen out of a pot pressed again are
obviously two different presses.

The options themselves are the right ones. A thickness dial with a number beside
it and a minus and a plus, so a thumb can nudge it and an eye can read it. A
stroke eraser and an area eraser as two named things rather than as degrees of
one, because they are two different jobs: a whole letter gone, or a hole in a
drawing. Lasso or rectangle. Opacity on the highlighter. Straighten lines. A
real colour picker with swatches, a spectrum, hex, an eyedropper and the colours
you used lately, which on a drawing matter more than the presets do, because a
drawing is three colours used over and over.

**What is bloat.** Eighteen icons in one row, and five of them are a puzzle:
tape, ruler, lock, AI, convert to text. Tape is a picture of stationery for
something no other app has. Convert to text and AI are a different product
wearing the same bar.

**What is unintuitive.** Every popover is laid out its own way, so nothing you
learn in the pen's transfers to the eraser's. The eraser hides two switches that
break it silently: leave "erase highlighter only" on and the eraser stops working
on your handwriting with nothing on screen to say why. The nibs are drawn as five
illustrated pens, which is five pictures of one object and reads as decoration
next to the flat marks in the rest of the bar. And the bar owns the top edge in
landscape, which is where a right hand rests its wrist.

## Miro

**What it does nicely.** One visual language: a single outlined icon set, one
weight, on floating white cards over the board. The tool in hand is tinted, not
outlined, not raised, so which one is live is never a guess. Flyouts open beside
the tool they belong to rather than in the middle of the screen. Every tooltip
carries the tool's name and its key, which is how a person moves from clicking
to typing without reading anything. Undo and redo are their own small card, and
so is zoom, with fit, minus, the percentage and plus, so the number is both the
readout and the button. Smart drawing turns a wobbly circle into a circle. The
pen flyout keeps three colour circles, which is the same insight as Samsung's
three slots: a colour should not cost a trip through a picker.

**What is bloat, for us.** Templates, tables, kanban, stickers, GIFs, emoji,
comments, talktrack, AI, and a catalogue of 4,700 shapes. That is a whiteboard as
a workplace. A canvas in a note taking app is a place to think next to your
notes, and every one of those would be a second product to keep working.

**What is unintuitive.** The rail is down the left edge, which on a tablet is
exactly where the drawer is dragged from and out of reach of both thumbs. Frames
and groups are two features with one name each and no visible difference. The
shape flyout is a list of words, so choosing a rectangle means reading. Zoom
lives in the far corner from the tools, and undo is in a third place again.

## What we took and what we left

| From Samsung | |
| --- | --- |
| Press the tool you are holding to open its options | kept, for every tool on the bar |
| The width and the colour visible without opening anything | kept |
| Stroke eraser and area eraser as two named things | kept |
| Lasso or box, and whether a half caught stroke counts | kept |
| Opacity, and a straighten switch | kept |
| Recent colours beside the presets | kept |
| Favourite pens set the way you set them | kept, as exactly three |
| Illustrated nibs, tape, ruler, lock, AI, convert to text | left |
| A switch that spares one kind of ink | left, it breaks the eraser silently |

| From Miro | |
| --- | --- |
| One outlined icon set at one weight | kept, Lucide, the app's own set |
| The live tool tinted rather than raised | kept |
| Flyouts anchored to the tool that opened them | kept |
| Name and key in every tooltip | kept |
| Undo, redo and zoom as their own groups | kept, in the one bar |
| Shape recognition | kept, as a switch on the pen |
| A left rail | left, it fights the drawer and the thumbs |
| Templates, kanban, stickers, comments, AI, 4,700 shapes | left |

## One bar

There was a bar for a mouse and a second one for a finger. Two bars is two
designs, two lots of drift and two places to fix anything, and the difference
between them was never really the pointer: it was size. So there is one bar now.
It holds the same buttons in the same order everywhere, and a touch screen reads
the `--touch-*` scale for them, the way every other surface in the app does.

Left to right, in the order a hand uses them:

```
[arrow] [hand] | [pen] [pen] [pen] [eraser] [lasso] | [put down] | [ink] | [undo] [redo] | [-] [92%] [+]
```

Arranging is on the left, drawing is in the middle, and what a press puts on the
plane is one button with a grid behind it: a card, a note or a picture, a link, a
frame and the four shapes. Eight things one press deep rather than eight buttons,
because a hand that is drawing never wants them and a hand that is arranging
wants one of them at a time. Each of them has a key, and the tooltip says which.

**Three pens, always three.** A pen is a thing you own rather than a setting you
pick, so a favourite is the whole pen: which nib, how wide, how much of the
colour lands, and which colour. Three slots, never more and never fewer, so there
is no adding, no putting away, no dragging them into order and no row that
outgrows the bar. Press one to take it, press it again to open it up.

**Where the bar sits.** Bottom centre. The left edge belongs to the drawer, the
top edge is where a tablet in landscape puts your wrist, and the bottom centre is
in reach of both thumbs on a phone and clear of the pane's own corners. A tablet
can still drag it to the top edge and fold it away to a handle, because a right
hand writing on the lower half of the page wants it gone, and the device
remembers which; that is a question only a tablet has, so only a tablet is asked
it.

## One popover

Every tool's options open in the same shell, anchored over the button that opened
them, and each is built from the same three rows: a preview at the top, dials
with a number and a minus and a plus, and switches under them. The pen's preview
is the line it will write, drawn by the same outliner that paints the plane, so
what the panel shows is what the nib does. The eraser's is its nib at its real
width on the paper.

There is one row of colours in the app: the six the theme names, the ones used
lately, no colour at all, and every other colour behind the wheel. The pen's
popover shows it for the pen; what is picked shows it for what is picked.

## What is picked

A small bar over the selection: its colour, duplicate, delete, and the rest. It
is the same four things a hand does to a card it has just put down, and it is
where the hand already is, rather than at the bottom of the pane. Everything else
that can be done to a selection stays in the menu behind the fourth button, which
is the menu a right click and a long press already open, so there is one list and
not two.

The colour a shape or a card is given is remembered as the colour the next one
gets, which is the only thing on the plane that carries over from one object to
the next.

## Zoom

Minus, the percentage, plus. The number is the button that fits the whole plane
in the pane, which is the only other thing anybody asks of a zoom. Pinch, the
wheel and the keys do the rest and always did.

## Keys

Every tool has one, every one of them is in the shortcut registry, and the
tooltip shows it. So the bar teaches the keyboard: a mouse hand reads `R` under
the rectangle once and stops using the button. On a touch screen the tooltip
drops the key, because a key means nothing to a thumb.

## The first canvas

An empty plane says one line in the middle, and it fades the moment anything is
on the plane and never comes back. That is the whole of the teaching. A tool bar
that has to be explained is a bar that is wrong.

## Two hands and a pen

The rules a tablet is held to, all of them in `canvas/pointer.ts` and all of them
tested there rather than tried by hand:

- **A pen writes and a hand moves the page.** The first time a pen touches this
  glass the finger stops being a nib, whichever pen the bar is holding, because a
  palm resting on a page while the other hand writes must not leave a mark. A
  phone has no pen, so there the finger draws.
- **Two fingers are the page, in every tool.** Wherever a second finger lands it
  takes over as a pan and a pinch, whatever the first one had started: a card
  being dragged, a band, a shape, or a stroke. A stroke a moment old is given up
  for it, which is what every drawing app does. A stroke older than that keeps the
  glass and the second finger is read as a palm, so a long line is never lost to
  a hand settling on the page.
- **A tap in a drawing tool is a dot.** Always. Nothing on the plane is ever
  created by a tap with a pen in hand: a card comes from the tool that puts one
  down, or from a double press with the arrow, and from nowhere else.
- **A press held still means something once.** Under a finger it is the menu.
  Under a pen that is drawing it is the stroke asking to be straightened, and only
  when the pen's own switch says so. Never a menu under a pen: a nib resting on the
  page is a hand thinking.
- **A pen with its button held rubs out**, whatever the bar says, set the way the
  eraser is set. Chromium reports that button as the eraser bit on a desktop and as
  the right mouse button on Android, so both mean it, and a pen never opens the
  context menu: the menu is the mouse's and a finger's. What the stroke is is
  settled when the nib touches down, the way Samsung Notes settles it, so a button
  pressed halfway through a line does not turn the rest of the line into an eraser.
  A button that was down all along and only reported in the second event still
  rubs out, because that is the same contact having changed its story.

Samsung's S Pen reports the first event of a contact as a finger on some
devices. A pointer that says pen a moment later is a pen from its first sample:
the gesture the finger started is thrown away and the stroke begins where the nib
landed. Without that, the first press after picking the tablet up draws nothing
and pans instead.

One thing outside the app's reach: in a browser tab, Samsung's Air actions can
take the S Pen's button for themselves while the pen hovers over the glass. If the
button rubs out in the installed app and does nothing in the browser, that is what
it is, and turning Air actions off for the browser is the fix.

## Where the code is

| | |
| --- | --- |
| `canvas/pointer.ts` | every gesture, as a reducer over events, with no DOM in it |
| `canvas/contacts.ts` | what each pointer claimed when it landed, and what it changed its mind about |
| `canvas/tools.svelte.ts` | which tool is in hand |
| `canvas/pens.svelte.ts` | the three pens, the eraser, the lasso, and where the bar sits |
| `canvas/hand.svelte.ts` | whether this glass has seen a pen |
| `canvas/glyphs.ts` | the Lucide icon, the words and the key for everything on the bar |
| `canvas/ink.ts` | outlines, erasing, lassoing, and what a wobbly shape was aiming at |
| `Canvas.svelte` | the surface: hit testing, the events, and the effects carried out |
| `CanvasBar.svelte` | the one bar, and the popovers over it |
| `CanvasPicked.svelte` | the bar over what is picked |

## What we deliberately do not have

- **A ruler, tape and a lock.** Three pictures of stationery for three things
  nobody asked for.
- **An eyedropper.** The web has one on exactly one platform, and a colour picked
  off the drawing is a nicety next to the six presets and the last six colours.
- **A switch that spares one kind of ink.** It breaks the eraser with nothing on
  screen to say why.
- **Templates, kanban, stickers and comments.** A canvas is next to your notes,
  not instead of them.
- **A second row of the same buttons for touch.** One bar, one order, one design.
