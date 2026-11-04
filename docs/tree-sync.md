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
| a rename, move or restore and a delete that had not seen it | The other change wins, as an edit does: a delete takes only what its device had seen. A device's own changes never stand against its own delete, and neither does the account's bookkeeping (folders made from paths at the move to v2). |
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

## Known gaps

What the tree walks found when they were first run, each pinned as an expected failure
until the step of #1068 that removes it lands:

- **An older app's drag in a folder that has places is not read.** Builds from before
  places still keep the order per folder path as a list of names (`arranged`, synced
  through the account, last writer per folder), and newer devices write that list from
  the places so older ones draw the same order. The other way round only happens once:
  a folder arranged before its space kept places becomes places on the first newer
  device to pass over it. After that, an older app dragging rows of that folder writes
  a list nobody newer reads, and the next newer device to pass writes the places' order
  back over it.
