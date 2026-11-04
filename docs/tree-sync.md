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

A delete is a fact, not an absence: the account keeps the entry with a tombstone and the
cursor it was deleted at, so a device that comes back after a week does not send up the
entry it still holds as though it were new. Deleted entries go to Recently deleted, where
they can be restored.

## What the simulation holds

`@orden/sync-core`'s simulator (`packages/sync-core/test/sim`) drives devices over a
network that drops, repeats and delays, with devices offline, quitting and crashing, and
then checks what everybody holds once it goes quiet (checks.ts):

- every device holds the account's tree and texts;
- names are unique per folder, and every live entry is in a live folder;
- no folder is inside itself;
- nothing exists that nobody made, and no note's words are live in two notes at once
  (bar a copy a person asked for by keeping both sides of a question);
- every word ever typed is in a note or in a version, unless a person took it out;
- what a person restored is there, under its id, unless somebody deleted it again.

The tree walks (`mix: 'tree'`) draw mostly moves, renames, deletes and restores on four or
five devices. They run against the reference account and devices (`tree-walks.test.ts`)
and with the app's own sync engine as every device (`apps/desktop/src/lib/sync2/sim.test.ts`).

## Known gaps

What the tree walks found when they were first run, each pinned as an expected failure
until the step of #1068 that removes it lands:

- **A folder delete takes a note its device wrote in but never saw there.** A note
  another device moved into a folder, written in by a device that never heard of the move,
  goes with the folder when that device deletes it: a content change makes the writing
  device the entry's last changer, so the folder delete reads the note as its own. The
  account has to keep who last placed an entry apart from who last wrote in it (reference
  seed 632).
- **A restore from this device's trash makes a new note.** The trash puts the files back
  on the disk and the engine hears them as files made, so the note comes back under a new
  id, beside its own tombstone. Restoring has to be an operation on the id.
- **Order is not part of the tree.** The order somebody dragged a folder's rows into is
  kept per folder path as a list of names (`arranged`), last writer wins per folder: two
  people reordering one folder overwrite each other, and a rename or a move loses the
  place. It becomes a position on each entry.
