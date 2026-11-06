# How the tree syncs

What happens to the file list - the folders and notes of a space, where each is and in
what order - when several devices or several people change it at once, online or not
(#1068). The words inside a note are docs/sync-v2.md section 5; this page is the tree
around them. The rules live in one place, `@orden/sync-core/tree`, which the Worker
applies and every device applies to its own changes before the account has answered.

## Identity

Every folder and every note is an entry with an id that never changes: not when it is
renamed, not when it is moved, not when it is deleted and restored. Its name and its
folder are fields of the entry; its path is worked out from them for showing, and is
never what says which entry it is. Two entries with the same name in the same folder
are two entries.

## Operations

A device says what the person did as an operation on ids, with the account's cursor it
had seen when it did it (`seen`):

| Operation | Says |
| --- | --- |
| `mkdir` | a folder, with its id, its folder and its name |
| `create` | a note or a file, with its id, its folder and its name |
| `rename` | an entry's new name |
| `move` | an entry's new folder, and a name where the old one is taken there |
| `delete` | an entry gone, and for a folder everything in it the device had seen |
| `restore` | a deleted entry back, with the folders above it, and for a folder what was deleted with it |
| `place` | an entry put somewhere else among the rest of its folder, by hand (its new position) |

`mkdir`, `create` and `move` may carry a position too: where the entry was dropped.

The account applies operations in the order they arrive and answers each with what became
of it; every device applies the account's feed in that same order, so every device ends on
the same tree. An operation carries its own id, so one that arrives twice is applied once.

## When two changes cross

| Crossing | What happens |
| --- | --- |
| move and move | The later to arrive decides where the entry is. |
| a move that would put a folder inside itself | Refused as a cycle; the device that made it puts the folder back. |
| rename and rename | The later to arrive decides the name. |
| two names one folder cannot both hold | The second is numbered (`Plan 2.md`), compared as the disk compares names: case and accents folded. |
| move and delete | A move made without having seen the delete brings the entry back; a move the device made knowing of the delete cannot, since it no longer shows the entry. |
| delete of a folder and a change inside it | Whatever another device created, moved in, renamed, restored or edited inside since the deleting device last looked stays, and keeps the folder. |
| edit and delete | The edit wins: a delete of a note whose words changed since the deleting device last pulled them is refused, and that device puts the note back. |
| a rename, move or restore and a delete that had not seen it | The other change wins, as an edit does: a delete takes only what its device had seen. A device's own changes never stand against its own delete, and neither does the account's bookkeeping (folders made from paths at the move to v2). Nor do they hide another device's: a change of the deleting device's own made since, a restore or words, does not let its delete take a change by somebody else it had never seen. |
| delete and restore | The restore brings the entry back under its id, with its folders. A restore of something already back still counts as that person's change, so a delete that had not seen it leaves the entry. |
| two creates of the day's note | One note, both texts merged (docs/sync-v2.md 5.9). |
| reorder and reorder | Each drag moves only the row that was dragged, so two people arranging one folder at once both keep what they did; two drags of one row, the later to arrive stands; two rows dropped into one gap stand side by side, their ids deciding which first. |
| reorder and rename, or move | The position is the entry's, so a rename keeps it. A move to another folder leaves it behind unless the move says where the entry was dropped there. |

## Order

A folder's rows stand in the order somebody dragged them into, where anybody did: each
entry may carry a position (`pos`), a fractional index (`@orden/sync-core/order`) - a
short string of base-62 digits that sorts as text, so a row dropped between two others
gets a position between theirs and nothing else is renumbered. Rows with a position come
first, by position and then by id; rows nobody placed follow, in the folder's own order
(by name, by time).

On a device the places are the engine's (`order:<space>` in the sync store's `meta`,
beside the tree rather than in a new column, so going back to an older build costs the
places and nothing else). The file list reads a folder's order from them where the
account says it keeps places and somebody put a row of that folder somewhere, and turns
a drop into the places it needs (`repositioned`): the rows whose places already rise in
the wanted order keep them, so one row dragged is one `place` sent. A device sends
places only to an account whose feed says it keeps them, and drops what it holds if the
account answers a batch with one in it as a request it cannot read - an account put back
to a build from before places.

Who last put an entry where it is and who last wrote in it are two things the account
keeps apart (`placed_seq` and `placed_by` on a note, 0068). Writing in a note makes its
writer the last to change it, but not the one who put it in its folder: a device that
wrote in a note somebody else had moved into a folder, never having seen it there, has
still not seen it there, and its delete of the folder leaves it.

The last changer is one device, and a delete has to know about every other one. So the
account also keeps, on each folder and note, the cursor of each device's latest change to
it, a delete aside (`changes_by`, a JSON object from device to cursor, 0074), written by
the tree's rules and by every save that names its device. A delete is refused if any
device but its own has a cursor there past its `seen`. Without it, a device that deleted
a note, restored it and deleted it again while away came back with its own restore as
the note's latest change, and a restore another device made in between, which it had
never seen, did not stand against the second delete (seeds 3175 and 3900). A delete that
stands empties it: it had seen every change it took, so none of them stands against the
next delete once something brings the entry back. A row without it, or written by a
Worker from before it, answers by its last changer as before; an app never reads it.

## What this device does

A move, a rename or a delete made in the file list, by an agent or by an undo is said to
the engine by the id of what is there before the disk has it (`moving` and `removing` in
the engine, through `doing` in workspace/file-ops.ts): the op is in the outbox and shown at
once, and the entry and everything in it are in hand while the file moves, so a pass
leaves them alone and the folder's watcher hears nothing there that needs reading. Where
the file is is written down once the disk has it; a move the disk refuses is put back the
same way. Should Orden stop halfway, the next pass finds the entry shown where the op put
it and moves the file there itself.

The watcher reads what it hears against the tree and the disk as they are, never against
how long ago anything happened: a path where the tree and the disk do not agree yet - an
entry whose file is somewhere the tree no longer shows it, or a place the tree shows one
whose file is not there yet - is the engine's own work under way and nothing to read
(`ownWork`), a file heard gone that is there again was taken again since, and one heard
made that is gone again went again. What is left is somebody else's doing: a program, or
a person in Explorer or Finder.

A browser that keeps only the words it uses (docs/sync-v2.md 9.4, #1126) lists every
entry of the tree, and one it keeps no words of is where the tree shows it: the file list,
an agent or an undo moving or deleting one says it to the engine by its id exactly as for
any other, and there is no row to move. What its delete takes is what the person saw
listed, as of the space's cursor: anything written or moved in before then goes with it,
and anything after is kept from the delete, as for a delete made anywhere else.

## What the file list shows of it

A change from another device reaches the file list as the engine makes it on this disk,
not at the end of the pass that brought it: each move or rename the engine makes is the
row moved in the list at once (`heardMove` in workspace.svelte.ts), each delete the row
gone (`heardGone`), and what came to be is listed with the pass, as a note's words are.
A row is kept by an id of its own that follows every move and rename said to the
workspace (row-ids.ts), not by its path, so:

- the row is the same element before and after, and the keyboard stays on it: the list
  puts it back on the row in the same frame if moving the element took it off;
- what is picked follows its rows to their new paths, and a row deleted elsewhere leaves
  the selection with what was inside it (workspace/selection.svelte.ts);
- the note being read, renamed or moved elsewhere, is still the row lit and picked, and
  the list is not scrolled to it;
- where the reader has scrolled, rows that came or went above what is in view move the
  scroll by as many rows, so what was in view stays where it was; a row moved within the
  view, or out of it, leaves the scroll alone (`anchorShift` in tree-settle.ts);
- every row that changed place slides from where it was to where it is, and a row that
  was not there fades in (`settle`). Nothing moves for a reader who asked for as little
  movement as possible; the rows are simply where they are.

Twists are not part of this: a folder opened or shut slides as it always has.

What this device does goes up as soon as it is done, a row dragged among the rest of its
folder as well as a move or a rename (a pass a moment later, as for words saved), so
another device sees it a couple of seconds after. apps/desktop/test/e2e/tree-live.py holds
all of this on two devices against the real Worker, frame by frame, and a third that asked
for less movement.

## Signed out

A space used with nobody signed in is kept by the same engine, with no account behind it
(apps/desktop/src/lib/sync2/local.ts): on the desktop, every space of the workspace is a
space of a store of its own (`local`, never an account's), named as no account names
one (`local-…`). Its first pass makes an entry of everything in the folder, each with an
id, and each note a document holding its words; after that, what the file list, an agent
or an undo does is said to the engine by id before the disk has it, and what another
program does is heard by the folder's watcher, exactly as signed in. A pass asks nothing
of the network: this device is the space's account, so the outbox is applied to the
tree it holds by the rules the account applies, every change its own, and what was typed
is confirmed as it stands. Something whose making the rules refuse - its folder gone - is
made again where its file is, under a new id, rather than being taken off the disk.

Signing in lets that store go: the engine kept signed out stops before the account's opens
its store (the crate keeps one open at a time), the ids of everything it kept are carried
into the account's store (`carried:<root>` in its `meta`, until that space's first pass),
and the store is deleted, so a later session signed out starts from the folders as they
are then and never makes the disk agree with a tree from before. The account's first pass
of each space matches the folder against the account as it always has; what the account
has never heard of is made there under the id it had signed out, since the account takes
the id a device chooses for what it makes (a create under an id that was ever another
space's is refused). What the account already has keeps the account's id; tabs, places
and open folders are kept by path, so neither touches them.

Signing out carries them the other way: the ids of everything the account's store held go
into the store kept signed out, beside the account they came from (`from:<root>`), and its
first pass of each space makes every entry under the id it had signed in. Signing in to
that account again sends them back as they are; signing in to another leaves them behind,
since a space there may not make an entry under an id another space made, and what was
made signed out goes up under its own. A note the account still will not make under its id
even at the top of the space - one another space once made, or this space's own gone for
good - is made again under a new id with what its file says, never left unsent.

## Storage of its own

A space whose files Orden keeps itself answers the same file commands a folder does
(#1068, step 4c), through the browser build's own: its commands
(apps/desktop/src/lib/web/commands.ts) read and write rows keyed by path, and a store of
rows can be mounted at a folder (`mountRows` in web/store.ts), so what is at or under it
is that store's and not the browser's. A read of every row is every store's, in path
order.

Such a space is a folder of Orden's own (apps/desktop/src/lib/internal): every file's
bytes are `.entries/<key>`, a key given when the file is made and never read a name off,
and one index says which path each key is at, with the folders and the space's own
Recently deleted. The index is written whole into the older of two slots, as a new file,
so a write cut short leaves the one before; every window of the app changes it under one
lock and tells the others, which read it again before they answer. A rename or a move is
the index written again and no byte moves; a delete into the trash keeps the bytes, so
what comes back from it comes back under its keys, and so under the ids the engine
remembers it by (step 3a). Every change is said by what made it, exactly, as a folder's
watcher would hear it (`heard`).

On a desktop `invoke` sends the file commands for a path in such a space to those
commands over its folder, and every path is turned into the browser's spelling on the way
in and back on the way out (internal/route.ts); Recently deleted lists both sides. A call
that would go from one such space to somewhere else is refused rather than made by the
crate, and so is any path in no mounted store, so a call site that was missed fails
loudly instead of writing where nothing of the space is. The engine's disk is the same
commands, so its moves are index lines too, and the first pass of such a space lists the
index.

Nothing of the crate walks such a space (step 4c2): the engine hears its folder's own
word on every change in place of the crate's watcher, and reads its index in place of
the crate's listing when the watch begins (`hearInternal`, `listInternal`); the file
list, the link scan and a PDF's highlights are the commands above; a search and the
search held warm between two questions are the browser build's walk over the rows, on
the window's thread, following the folder's word on every change (internal/search.ts).
A shell is started where one with no folder starts, the Mac's Shortcuts keep adding to
the inbox they had, and a PDF handed to Orden is refused there rather than written onto
the disk at the space's address.

Such a space's inbox (`.Inbox.md`, #1044) is a document only its store holds (step
4c3): a line of its index and bytes under a key, never a file in a folder anybody else
reads, and never a row of the list, a note of the link scan or a hit of the walk - the
browser build's walks now leave the app's own dotted files out as the crate's always
did, and a search finds the inbox once, by itself, on all three. Sync carries it as the
note it has always been, under the name it has always had, so an older app and an older
account see what they always saw; a space's hidden file is taken in with the rest of it
when the space is converted (step 4e), and written out again by Export (step 4f).

Where a device says so (`nib:keep-spaces` in the window's storage, step 4d), a new space
is one of these: a folder of `.orden` in the spaces folder, named as the space, holding
its bytes and its index hidden and one file named as the space too, which is the space's
root - the address the rest of the app holds it by. A file, so nothing can be made under
it: a call that reaches the crate with a path in the space by mistake fails out loud
instead of writing beside the bytes. The crate lists a dotted folder as no space, so the
spaces are listed by Orden beside the crate's folders, found as the folders of `.orden`
whatever the device says, and mounted as they are found; a rename renames the folder
and moves nothing in it, and a delete takes the folder whole into Recently deleted, from
which it comes back whole. A note moved or copied between such a space and a folder is
written where it goes, with its highlights or its paper, before it is taken from where
it was; between two such spaces it goes as rows from one store into the other. A PDF
handed to Orden is not yet brought into one.

Where a device says so, each space that is still a folder becomes one of these too,
once (step 4e, internal/convert.ts), at the last turn of the launch: every file the
space holds - what the list shows, the papers page notes hold, every other file, and
the inbox, but none of the app's other dotted files - is copied in under the path it
had, read back and checked against the file it came from; then, with the writes of
every note open in it held, what changed meanwhile is copied again, and the space moves
to its new root as a rename does, so everything kept by path follows it and the engine's
entries keep their ids. A copy that does not check out leaves the space the folder it
was, to be tried again next launch: a full disk, a file that reads back wrong, two names
the folder tells apart that are one name here. Before anything is copied the folder is
copied whole into `.orden/.backups`; while the copy is made, the kept folder says so
(`.converting`), so one a crash cut short is never listed and is begun again from the
start, and one conversion runs at a time. Turn this space back into a folder makes it
the folder again: the folder backed up once more, every file of the space written into
it as the space has it now, what the space no longer has taken into Recently deleted,
the space moved back as a rename does and its kept folder into Recently deleted whole;
that folder is made a kept space no more on this device (`.orden/.folders`). Until then
the folder is left exactly as it was and is listed and written no more - the kept space says which folder it was (`.from`), and one deleted
afterwards leaves a line in `.orden/.retired` - so a build from before reads that folder
as it always did, and going back costs only what was written since.

A space is files anybody else can read only when somebody asks for them (step 4f,
internal/export.ts): Export this space as Markdown and folders writes every file of it,
the inbox too, where it is in the space and under its own name, into a folder of its own
inside a folder picked for it, numbered where the name is taken, so nothing there is
written over. It is made once, when asked, and never kept in step after; a space that is
a folder is written out the same way.

A folder from outside - an Obsidian vault, a folder of somebody else's notes - is only
ever read, by an import into a space (#552, step 4g): nothing opens one in place, and
an import into a space Orden keeps lands in its store like any other write. A space that
was a folder in place, a vault among them, is taken in once by the conversion above with
its ids, its sync and its versions (`rehome_snapshots`), and with what says it was a
vault (`.obsidian`'s settings files, so a `📅` stays a deadline there, #371); the rest of
Obsidian's settings, and the folder itself, stay where they were and are changed no more.

## What is kept about an entry

A folder's icon and its colour are kept on the account by the folder's id, and a
bookmark of a note, a folder, a heading or a block carries the id of what it points at
(`id`, where sync knows it). So when the tree moves, the account writes each list again
from where its entries now are (`reproject` in the Worker's sync2/maps.ts), and an older
app reads the paths it always did. On a device, a bookmark whose path names nothing is
read where its id now is (`located` in workspace/bookmarks.svelte.ts); a path is still
what is read where there is no id. An older app drops the id as it reads, and the account
keeps it through that app's writing the list back.

## Putting a delete back

A delete made here is said to the engine with a word to put it back by: the trash's id
for what it holds, or the undo's own. The engine keeps where the entry and everything in
it were on this disk (`gone:<space>` in the sync store's `meta`, the newest two hundred),
so when the trash or an undo puts the files back and says so with that word, each comes
back as the entry it was, under its id: a `restore` to the account, which brings it back
with the folders above it, over a delete that had not seen it, and its words come down
again by the next pull, what the file said kept as a version where they differ. One made
here whose making has not gone yet loses the delete behind it instead, its words its
file's; one the account never heard of, or no longer has, is made again under its id
with what its file says. A file put back by no such word, or where something else is now,
is a file made.

A delete is a fact, not an absence: the account keeps the entry with a tombstone and the
cursor it was deleted at, so a device that comes back after a week does not send up the
entry it still holds as though it were new. Deleted entries go to Recently deleted, where
they can be restored.

## What the simulation holds

`@orden/sync-core`'s simulator (`packages/sync-core/test/sim`) drives devices over a
network that drops, repeats and delays, with devices offline, quitting and crashing, and
then checks what everybody holds once it goes quiet (checks.ts):

- every device holds the account's tree and texts, each row where the account has it
  among the rest of its folder;
- names are unique per folder, and every live entry is in a live folder;
- no folder is inside itself;
- nothing exists that nobody made, and no note's words are live in two notes at once
  (bar a copy a person asked for by keeping both sides of a question);
- every word ever typed is in a note or in a version, unless a person took it out;
- what a person restored is there, under its id, unless somebody deleted it again.

The tree walks (`mix: 'tree'`) draw mostly moves, renames, deletes and restores on four or
five devices; the order walks (`mix: 'order'`) draw rows dragged among the rest of their
folders as well, and every device has to end with each row where the account has it. They run against the reference account and devices (`tree-walks.test.ts`)
and with the app's own sync engine as every device (`apps/desktop/src/lib/sync2/sim.test.ts`).

Every night both walk seeds no night walked before, from three to eight devices by the
seed (`crowded` in the simulator's run.ts), each with long stretches offline, quits and
crashes (.github/workflows/walks.yml): ten thousand seeds of each mix against the
reference devices (`SIM_MIX=tree` or `order` for `pnpm --filter @orden/sync-core
sim:long`), and ten thousand of each with the engine as every device (`SIM_MIX` for
`pnpm --filter @orden/desktop sim:long`). A failure names its seed and its mix, and
`SIM_MIX=<mix> SIM_FROM=<seed> SIM_SEEDS=1` replays it.

What the many devices found in the reference devices themselves, and fixed there (the
engine already did both): words pulled while the same note was being deleted here were
taken for the whole note when they were only what this device lacked, leaving it empty
for good (seeds 528, 226); and an operation the account had answered left the tree a
device shows until the feed said it again, so a folder deleted in that moment did not
take the note just moved into it, though the account did (seed 5244). The engine's walks
never showed either.

Ten thousand seeds of the tree with the engine as every device found three more. Two are
fixed: a folder made here inside one deleted here, put back from the trash while away,
was said to the account only as the outer folder's restore when the outer delete was
already on its way, and that delete had taken the inner one with it; it now goes up as a
restore of its own (seed 2412). And the simulated trash put a folder back beside one
whose folder on disk it did not look at (seed 9654). The third is a known gap, below.

## Known gaps

What the tree walks found when they were first run, each pinned as an expected failure
until the step of #1068 that removes it lands:

- **A folder restored inside one deleted after it, all before the account heard of
  either, is lost.** A device makes a folder inside another, deletes the inner one, then
  the outer, and puts the inner one back from the trash, all while away. The outer
  folder's delete folds every one of them away as never made (`coalesce` in
  @orden/sync-core/outbox), and the restore goes with them (engine seed 8388). Keeping
  them in the outbox when a restore follows broke a reference walk that deletes the
  restored folder again (seed 2316); the fold has to tell those two apart.

- **An older app's drag in a folder that has places is not read.** Builds from before
  places still keep the order per folder path as a list of names (`arranged`, synced
  through the account, last writer per folder), and newer devices write that list from
  the places so older ones draw the same order. The other way round only happens once:
  a folder arranged before its space kept places becomes places on the first newer
  device to pass over it. After that, an older app dragging rows of that folder writes
  a list nobody newer reads, and the next newer device to pass writes the places' order
  back over it.
