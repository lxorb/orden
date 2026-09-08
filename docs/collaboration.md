# Writing in one note from several devices

A note open on a laptop and a phone at the same time is one note. Both people see
the other's caret, both see the words appear as they are typed, and a device that
was on a train catches up when it comes back without anybody being asked which
copy to keep. This is how that works, and why it is built the way it is.

## What everyone else does

**Google Docs** serialises everything through a server, using operational
transformation in the shape of the [Jupiter model][jupiter] (Nichols, Curtis,
Dixon and Lamping, UIST '95). Each client keeps a queue of edits it has sent and
not had acknowledged; an edit arriving from the server is transformed against
everything still in that queue, and the queue is transformed in turn, so the two
sides reconverge. The server holds one revision log per document and one such
state space per client. The [Apache Wave whitepaper][wave], written by the same
lineage of engineers, is the closest thing to a published description: the client
"must wait for acknowledgement from the server before sending more operations",
and the server transforms each operation against its history, applies it and
broadcasts it. Undo in OT is a new inverse operation transformed against
everything concurrent, which is what makes it per user rather than a stack pop.
Offline is where the model strains: the merge cost grows with how far the two
sides diverged, and the [Eg-walker paper][eg] measures OT taking about an hour on
a trace that a modern algorithm merges in 24 ms. Correctness is the other cost:
"formal proofs are very complicated and error-prone, even for OT algorithms that
only treat two characterwise primitives", and several published algorithms were
later shown wrong.

**Figma** deliberately used neither. Their [engineering post][figma] says OT was
"unnecessarily complex for our problem space" and that CRDTs carry "unavoidable
performance and memory overhead" for a system that has a central server anyway.
What they built is a two-level map, `Map<ObjectID, Map<Property, Value>>`, with
last writer wins per property, a parent pointer stored as a property so identity
survives reparenting, and fractional indices for sibling order. They are blunt
about the limit: "simultaneous editing of the same text value doesn't work in
Figma. If the text value is B and someone changes it to AB at the same time as
someone else changes it to BC, the end result will be either AB or BC but never
ABC." A design tool can live with that; an editor cannot. When they later needed
real text merging, for [Code Layers][figma-code], they chose Eg-walker.

**Obsidian Sync** is file sync rather than shared editing. Its
[documentation][obsidian] says markdown conflicts are merged with Google's
diff-match-patch, which "preserves all edits" but can duplicate text, and that
everything else, canvases included, is last modified wins. Since 1.9.7 a device
can choose a conflict file instead, named `note (Conflicted copy device
YYYYMMDDHHMM).md`. Real-time editing in Obsidian exists only through the
third-party [Relay][relay] plugin, which uses Yjs.

**Notion** is block based. Their [own posts][notion] describe a record per block
with a `content` array of children and a `parent` pointer, clients applying
operations optimistically and queueing transactions to a `/saveTransactions`
endpoint, and a WebSocket that tells them which records changed. When they
shipped offline in August 2025 they said outright that "pages that are marked as
available offline are dynamically migrated to our new CRDT data model for
conflict-resolution" - the block model alone was not enough once edits could be
made while disconnected. Apple Notes and Dropbox Paper have published nothing
worth citing.

**The open source world settled on CRDTs**, and mostly on one. [Yjs][yjs]
implements YATA: every inserted run is an item with an id of `(client, clock)`
and a record of which items it sat between when it was written, and consecutive
typing is merged into a single item, which is why a note typed straight through
costs about what the note costs. It ships the pieces this needs as separate
libraries: `y-protocols` for the sync and awareness messages, `y-websocket` for a
provider, `y-codemirror.next` for a CodeMirror 6 binding. On the published
benchmark for a real editing trace of 260,000 operations, Yjs takes about 5.7
seconds and 3.2 MB where Automerge 2 took 14.3 seconds and far more; Automerge 3
has since closed most of that gap by holding its columnar format in memory.
[Loro][loro] is the most actively released of the three and uses Fugue over an
event graph. [Diamond Types][dt] is dormant as a crate but its ideas became
[Eg-walker][eg], which keeps an event graph and builds CRDT state only for the
duration of a merge - one to two orders of magnitude less steady-state memory.
[ShareDB][sharedb] is the maintained OT option, with `json0` as its one built-in
type. The debate is genuinely two-sided: [Sun et al.][sun] argue that OT remains
what almost every working co-editor is built on, and Kleppmann's ["CRDTs: The
Hard Parts"][hard] is candid that "simple implementations often have terrible
performance". The known CRDT anomaly is [interleaving][interleave]: concurrently
written runs can be shuffled character by character. YATA has the weaker form of
it rather than the full one, and Fugue is the accepted answer; neither shows up in
the case a note actually meets, which is two people writing in different places.

## What Nib does, and why

**A CRDT, and Yjs.** Devices go offline and come back, and that is the case OT is
worst at and a CRDT is best at: a device that wrote for an hour on a train merges
in the time it takes to apply its updates, with no server-held transformation path
to replay. Yjs specifically because it is the mature one, because its run-merging
makes a note cost about what the note costs, and because `y-protocols` is a
reference implementation of the wire so neither end of this is hand-rolled. Loro
and Eg-walker are both better on paper for very long histories; neither is worth
the risk for a note, and the format the words are stored in here is markdown
rather than a CRDT, so nothing is locked in - a room can be thrown away and reseeded
from the note at any time.

**Not `y-codemirror.next`.** Its `yCollab` binds one CodeMirror view to a `Y.Text`
and owns that view's document. Nib already has a document that several views share
- one note in two panes is one note, with one undo history, and each pane keeps
its own caret; see `packages/editor/src/shared.ts`. Two bindings over one text
would each apply the other's changes. So the binding here is between the room and
that shared document, in `apps/desktop/src/lib/rooms/bind.ts`, and it is a
translation between two descriptions of the same edit: CodeMirror's change set and
Yjs's delta. The remote carets are drawn by
`packages/editor/src/carets.ts`, which the design would have wanted anyway.

**Not `y-partyserver`, and not `y-durableobjects`.** Both were read.
[`y-partyserver`][yps] is the maintained one - Cloudflare's own org, hibernation
handled correctly since 2.1.0, 30,000 downloads a week - but it ships **no
persistence at all**: `onLoad` and `onSave` are yours to write, which is the part
that would have been reused. What it does bring is `partyserver`, a framework that
owns the routing and the Durable Object base class, where this Worker's routing is
Hono with a session guard and a hostname catch-all; and it pins
`@cloudflare/workers-types@^4` where this repo is on `^5`.
[`y-durableobjects`][ydo] is Hono-native and does persist, with an update log and
compaction at 10 KB or 500 updates, but it is 800 downloads a week from a single
maintainer, it keeps its sessions in an in-memory `Map` that hibernation resets,
and it has no hook for writing settled markdown into a note store or for seeding a
room from a stored note. What was left to write either way was socket
bookkeeping, persistence and the settle. So `services/sync/src/rooms/` is written
here, over `y-protocols` - the protocol itself is not hand-rolled - and it takes
two lessons from `y-partyserver`: the open sockets are asked of the runtime rather
than held in a field, and the awareness protocol's own timer is turned off,
because an object with a timer running never sleeps.

## The shape of it

```
the editor            SharedDoc            Room                 NoteRoom
(one per pane)   ->   (one per note)  ->   (one per note)  ->   (one per note,
                                                                 in the world)
 a keystroke          the words and        the Yjs document      the Yjs document,
 drawn at once        the undo history     and the socket        the sockets, the
                                                                 storage, the settle
                                                                        |
                                                                        v
                                                                 the note store
                                                                 (D1 and R2)
```

**The room.** One Durable Object per note, named by the note's id, so there is one
instance of it in the world and that is what makes it the place the sockets meet.
It holds the note as a `Y.Text`, passes every update on to the other sockets, and
keeps awareness so a caret arriving is a caret everybody sees. Its sockets
hibernate: the runtime may take the object out of memory between messages, so
nothing that matters is held in a field. The open sockets come from
`ctx.getWebSockets()`, what each socket announced is kept on the socket itself
with `serializeAttachment`, and the settle is an alarm rather than a timer.

**Getting in.** `GET /rooms/:noteId`, upgraded to a WebSocket. The token rides in
the socket's subprotocol - a browser will not put a header on a WebSocket, and a
token in the address ends up in logs - and the server names it back so the
handshake completes, which is also why the route sits outside the session guard.
One query answers both halves of the question: is the session live, and is the
note in a space this account holds. That single query is the whole of who may
come in, and it is the one function the sharing batch changes.

**Persistence.** The room's own storage holds a snapshot of the document plus a
log of what has arrived since, and folds the log in when it grows past 200 entries
or 64 KB. The snapshot is chunked at 96 KB so it never runs into a value limit,
and is written in Yjs's second encoding, which is the smaller one. Updates are
**not** written as they arrive: a keystroke that reached a storage write would
cost the room a row and the reader a wait, and a room is written into a keystroke
at a time. They wait in memory and go down together at the settle. Nothing is at
risk while they wait, because every device in the room holds the same keystrokes:
a room that woke without its last few asks for them, by sending sync step 1 to the
sockets that were already there.

**The settle.** A moment after the typing stops, the room writes the markdown into
the note store the way any other save writes it: the bytes into R2, the row's
version and the space's cursor moved on. Every device that is not in the room
reads that as an ordinary edit made somewhere else, which is exactly what it is,
so publishing, the connector, the glasses, exports and search carry on knowing
nothing about any of this. The last device out settles as it leaves.

**Joining, which is the part worth reading twice.** A device arrives holding a
file and the room holds words of its own. The document starts empty and is filled
by the room first, with the note left alone, so the two can be compared rather
than one silently landing on the other. Then one question decides it: is the file
still byte for byte what the account last handed this device? The file sync
already records that hash. If it is, everything that differs was written elsewhere
and the room's words go into the note as the edit they are, so every pane keeps
its caret. If it is not, this device wrote while it was away, and what it wrote
goes into the room as one replacement covering the piece that differs. Neither
case loses a word and neither leaves a second file to find. See
`apps/desktop/src/lib/rooms/join.ts`, which is the rule on its own.

That last case is the one place this is coarser than character-by-character
merging. A device that was *connected* when it went offline keeps its own copy of
the shared document, and everything it wrote merges per character on reconnect. A
device that was *closed* has only the file, and the file has no shared history to
merge against, so what it wrote folds in as a diff. Two devices that both rewrote
the same paragraph while closed will keep the later one's version of that
paragraph rather than interleaving them. The alternative - keeping the Yjs state
in IndexedDB with `y-indexeddb` - would close that gap at the cost of a
dependency, a second store per note that can go stale, and no help at all for the
other case it is really there for: a note edited by some other program, which is
the ordinary state of a folder of markdown files.

**The file sync.** A note in a room is the room's; `mirror.ts` neither sends it up
- the room already carried every keystroke - nor treats a version it has not seen
as a disagreement, so conflict copies for notes are gone. What comes down is
written and that is all. A note that is *not* in a room behaves exactly as it did
before, and so does a room that has been opened but has not yet settled with its
file: until that moment the file is still the best answer anybody has.

**Not canvases.** A `.canvas` is JSON, and merging two drawings as if they were
prose would make neither. Everything on a canvas has an id and a time of its own,
which is a better merge than a text CRDT can give it; see
`packages/markdown/src/canvas-merge.ts`. Rooms are for markdown notes.

## Carets and presence

A thin bar in the other device's colour where its caret is, a wash over what it
has selected, and its name above the bar for a second and a half after it moves.
No chat, no comments, no avatars, no toolbar.

Positions travel as Yjs relative positions rather than offsets, so a caret that
says "after this character" is still in the right place once somebody has written
a paragraph above it. Each end resolves them against the text it holds. Between
those messages CodeMirror maps the decorations through every local change for
nothing, so the app only speaks when somebody actually moves - and then only after
40 ms, because a held arrow key moves a caret more often than anyone can watch.

The colour travels as the name of an accent rather than as a colour: the shade a
colour needs to be readable on white is not the shade it needs on black, so which
shade is the reader's business. A device picks one accent, once, and keeps it, so
the phone is the same colour every morning.

The label is either the *device* - "Windows", "Android", "iPhone" - or the
*person*, and which one is not the sender's to decide. Two of one person's own
machines want to be told apart by machine: "Emil" on both carets answers nothing,
and the question those two carets raise is which of my machines that is. Two
people in a shared space want the opposite. Nobody knows which case a room is
until everybody has arrived, so both names travel and the choice belongs to
whoever is looking: a caret carries the person's name as soon as more than one
person is in the note, and the device's name otherwise. See `rooms/peers.ts`,
which is where the count is, and `rooms/who.ts`, which is where the two names
come from. A person's name is the one on their account, or the part of their
address in front of the at sign; never the whole address, which is not a name
and which the other people in a space were not necessarily given.

In the tab, one small dot per other device, in the accent, overlapping into a
stack, and nothing at all when nobody else is there.

**Undo stays yours.** A change that arrives from the room is applied to the shared
document with `addToHistory` off, so pressing undo takes back what you wrote and
never what somebody else did. CodeMirror maps what the history holds through every
arriving change, so the position it comes back to is still right.

## Sharing

A room holds whoever may reach the note, and until a space could be shared that
was one person's devices. This is what changed to make it people.

**A role, per space, per person.** Three of them, ordered: `read` pulls the notes
and joins rooms without writing in them, `write` edits everything inside the
space, `owner` is the space itself - its name, its icon, publishing it, deleting
it, and who else is in it. The line is worth saying plainly, because it is the
one thing anybody has to learn: **a writer writes in a space; the owner decides
what the space is.**

**A membership is an address, not an account.** `space_members` is keyed by
`(space_id, email)` and points at no user row at all. Accounts are keyed by the
same address and there is exactly one address per account, so the two meet on
their own: a row written for somebody who has never used Nib is already theirs
the first time they prove that address. Nothing has to be migrated when they sign
up, and nothing has to be reconciled if they never do. The owner is not a row
here - a space already says who owns it, and a second copy of that fact is a
second thing to keep true.

The whole of the model is `services/sync/migrations/0015_space_sharing.sql`, and
it is four tables: `space_members` above, carrying the invitation that was sent
to each row and when it stops being a shortcut; `space_links`, one per space,
with its role and its mode; `space_requests`, whoever followed a link that asks
first and what that link promised them, kept so that changing the link afterwards
does not change what somebody was already offered; and `mailed`, which is only
when an address was last written to.

**One query answers everything.** `reachedSpace` in `spaces/space.ts` joins the
space to the membership on the address and returns the role, or nothing at all;
`atLeast(role)` is the middleware in front of every route that names a space. A
space nobody may reach is a 404, exactly as an id from another account has always
been, and one they may reach but not at that role is a 403 - a different thing to
say, because the space is theirs to see and this button is not theirs to press.

| | read | write | owner |
| --- | --- | --- | --- |
| the change feed, reading a note | yes | yes | yes |
| making, writing, deleting a note | | yes | yes |
| bookmarks, the files beside the notes | | yes | yes |
| Recently deleted, for notes | | yes | yes |
| the connector's `write_note` | | yes | yes |
| the room's socket | read-only | yes | yes |
| renaming the space, its icon | | | yes |
| publishing, and the domain | | | yes |
| deleting the space | | | yes |
| inviting, roles, the link, requests | | | yes |

Two things are nobody's role. Images and PDFs are stored per account and served
by hash, so a writer's paste is their own blob and costs their own quota. And the
settings are per account rather than per space, so there is nothing there to
check; the two things a space itself keeps - its bookmarks and its file list -
are in the table above.

Quotas moved with all this: a note written in a shared space counts against the
**owner** of the space, because that is whose storage the bytes land in. Before
this it was counted against whoever was writing, which for one person was the
same number and for two would have been a way to fill somebody else's account.

**Getting in without an account.** A person is invited by address. The row is
written at once, so the owner sees them in the sheet immediately, and a mail goes
out with a link to `nibeditor.com/join/<token>`. The link is a way in rather than
*the* way in: what actually opens the space is the address being proved, by the
same emailed code the app has always signed in with. So an invitation forwarded
to the wrong person opens nothing, and an expired link costs its holder the
shortcut and not the space. The desktop app registers no URL scheme, so a link
opened there opens the web app; it is the same account either way.

What a person with no Nib account experiences, in full: they open the link, the
page says "Emil shared Notes with you" over a field already holding their own
address, they press Continue, they type the six digits that arrive, and they are
in the space. There is no sign-up, because proving the address is the sign-up.
A read-only visitor then sees the space in the rail like any other, opens its
notes, and finds an editor that will not take a keystroke and a strip that says
so; their menu on that space offers an icon and a way out of it and nothing else.
Nothing they do reaches anybody, and the file sync never offers their folder to
the account: a space shared to read only comes down.

**The link.** One per space, with a role and a mode. `open` lets in anybody who
follows it and proves an address; `approval` turns the same link into a request
the owner accepts or declines, and the owner is told by mail that somebody is
waiting. Changing what the link hands out changes it for the copy already in
somebody's message, which is what an owner means by changing it; a link that
should stop working is revoked, and the next one is a new token. It is the one
secret here stored as it is rather than hashed, because the owner has to be able
to copy it again tomorrow and a hash cannot be read back.

Mail is rate limited per address, at the same thirty second gap the sign-in code
keeps and for the same reason: it is the person receiving it who is protected,
whoever asked for the send. The membership is written whether or not the mail
went, because a mail that could not go out is not a reason for the sharing not to
have happened.

**The door, and a reader in a room.** The query at the top of
`services/sync/src/rooms/index.ts` now answers three things in one round trip -
whether the session is live, whether the note is in a space this account can
reach, and what they may do there - and passes the room exactly one bit:
`x-nib-write`. The room keeps it on the socket, beside the carets that socket
announced, so an object that slept still knows. A message that would change the
text is then dropped before it reaches the protocol; `isEdit` in `@nib/rooms`
is what tells one apart, and a reader may still ask what the room holds and say
where their caret is. The room learns nothing else about anybody.

The bit is read once, at the door, which is the one thing to know about it: a
role taken away or narrowed while somebody has the note open reaches them when
their socket next opens rather than at once. That is a pass of the file sync
away, because the pass that stops listing the space closes its notes and their
rooms with them, and it is the price of a room that costs no query per keystroke.
Everything over the API is decided per request and changes immediately; the tests
say so.

On the client
the editor is read-only for the same reason and by the same rule, per pane,
because the pane beside it may be showing a note of this account's own - the
machinery was already there, in `packages/editor/src/modes.ts`, and it already
lets changes from outside the editor through, which is what keeps a reader's view
live while the others type.

**On this machine.** A shared space is mirrored into a folder like any other, and
two things about it are not like any other. It never takes a folder of the same
name that is already here: pairing by name is a guess that this folder is that
space, and the guess is only safe about a space this account made itself, so
somebody else's Work is adopted beside your Work rather than into it. And when it
stops being listed it goes, rather than being uploaded again - a space somebody
shared is theirs to say exists, and "missing" there means the sharing was taken
back. Both rules are in `space-plan.ts`, which is a pure function and is tested
as one. Deleting such a space from the rail leaves it instead: it is not this
account's to delete, and the same gesture ends the membership and takes the notes
off this machine only.

The rail's order is the last small thing. `position` is a column on the space, so
a member reordering their rail would move the owner's; the order endpoint touches
only spaces the account owns, and a shared space sits after them.

## What it looks like

One sheet, from the space's own menu in the rail and from the palette: the people
with their role as a small select each and a cross to take them out, an address
field with a role beside it and one button, the link with its role and a two-word
segmented control for `Anyone` or `Ask first`, copy, revoke, and whoever is
waiting with Accept and Decline. A space somebody else is in carries a small
stack of dots on the corner of its square in the rail - the same two dots a tab
draws for the devices in a note, because it is the same fact said about a space.

## Cloudflare

Durable Objects, SQLite-backed. Confirmed against this account with `wrangler`:
SQLite-backed objects are already in use here, and the account is on Workers Paid.
SQLite-backed objects have been generally available since 7 April 2025 and are
what the free plan has always had; a new class **must** be declared as one.

```jsonc
"durable_objects": {
  "bindings": [{ "name": "ROOMS", "class_name": "NoteRoom" }],
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["NoteRoom"] }],
```

`new_classes` there instead of `new_sqlite_classes` fails to deploy on accounts
with no existing key-value namespace, and since 9 July 2026 no new ones can be
made at all. The configuration was proved with `wrangler deploy --dry-run` before
anything else was written, because the deploy job on main runs `wrangler deploy`
and a Worker that will not deploy takes the website with it.

## What it costs

Measured on one machine running all of it at once: an ARM64 Windows laptop with
the Worker under `wrangler dev`, whose runtime is the x64 build under emulation,
and the browsers beside it. A pessimistic setting - the round trip goes through a
local proxy a deployed Worker does not have - but an honest one, because nothing
here is a simulation.

| | budget | measured |
| --- | --- | --- |
| A keystroke, in a 100 KB note | under 16 ms | costs the keystroke, not the note: a hundredfold note stays under 8x, asserted in `bind.test.ts` |
| A letter crossing to another device | under 150 ms | **30 ms**, best 23 ms, over ten crossings |
| A 100 KB note joining a room, cold | under 300 ms | **225 ms**, from opening the note to the room and the file being one text |
| A room in memory | - | about 90 KB for a 100 KB note: the note's own characters and little else, because consecutive typing is one item |
| A room in storage | - | 100 KB for a 100 KB note, snapshot plus log |

The keystroke number is the one that matters most and it is structural rather than
lucky: a change set is the size of the change, and the shared text takes one
insert at one position, so nothing on that path walks the note.

Two things were measured and then fixed, and both were worth several times the
budget. Writing every update to the object's storage as it arrived cost a
keystroke a durable write, which showed as a letter taking over a second to cross
when a few were typed in a row; updates now wait in memory and go down at the
settle. And the door to a room asked the database three questions - the session,
the note, the space - where one does; that took a cold upgrade from 754 ms to
under 200 ms.

What the numbers are sensitive to is the machine rather than the design: the same
run on the same laptop with a few stray runtimes left over from earlier runs gave
146 ms for a crossing and 627 ms for a join. Both are the emulated runtime and the
browsers contending for one laptop, and neither is what a deployed Worker and two
real devices look like. The numbers above are from a quiet machine.

## Tests

- `packages/rooms` - the wire, both ends of it, which of its messages would write
  into a room, and the fold that puts a note written while away back into one.
- `services/sync/test/rooms.test.ts` - the room itself, driven with storage in a
  Map and sockets that record what they were sent: the greeting, two devices
  converging, a device that was away, the settle writing the note, the log folding
  into a snapshot, waking up, asking the devices that were here for what it slept
  through, the door turning away a stranger, the door telling the room what each
  person may do, and a reader who sees every keystroke, keeps a caret, and cannot
  add a letter by any of the three ways there are to try.
- `services/sync/test/share.test.ts` - every route that names a space, at every
  role, plus a stranger: sixty-odd cases from one table, so a route added without
  a role check is a failing test rather than a hole. Then invitations and links
  end to end over the API, somebody who had no account when they were invited,
  the mail's rate limit, roles changing under somebody mid-session, whose quota a
  shared note costs, and what the connector will and will not do in a space it
  was lent.
- `apps/desktop/src/lib/sharing.test.ts` - what the app believes it may do in a
  folder, and what each control on the Share sheet actually asks for.
- `apps/desktop/src/lib/space-plan.test.ts` - a shared space never taking a
  folder that is already here, and going when the sharing is taken back.
- `apps/desktop/src/lib/sync.test.ts` - a shared space arriving as a folder, one
  shared to read never being written back to, and leaving one rather than
  deleting it.
- `apps/desktop/src/lib/rooms/bind.test.ts` - the binding: convergence, both
  orders of arrival, offline edits, undo staying yours, and the keystroke cost.
- `apps/desktop/src/lib/rooms/peers.test.ts` - where a caret is, and whether it
  is labelled with the machine or with the person.
- `apps/desktop/src/lib/sync/mirror.test.ts` - the file sync leaving a note in a
  room alone, and still writing a conflict copy for one that is not.
- `packages/editor/src/carets.test.ts` - what the carets draw and where they move.
- `apps/desktop/test/e2e/collaborate.py` - two browsers, real keystrokes, the
  Worker under `wrangler dev` on workerd, a real Durable Object. Asserts that both
  converge and that the account ends up holding what they hold, photographs the
  remote caret and the tab's dots, and reports the timings above. It builds the
  app, starts everything and stops everything again.
- `apps/desktop/test/e2e/share.py` - three browsers that know nothing about each
  other. The owner opens the Share sheet from the rail and invites an address;
  that address has no Nib account, follows the link out of the real message the
  runtime's mail binding was handed, types the six digits, lands in the space, and
  writes in the same note as the owner with each caret carrying the other's name.
  Then a link that anybody may follow to read, and a third person who finds a note
  they can see, cannot type into, and is offered nothing to change.

The Worker's own suite runs against Node's SQLite rather than on workerd, which is
how it was already written; the room is tested the same way, with the runtime
stood in for, and gets its workerd coverage from the end-to-end run. Adding
`@cloudflare/vitest-pool-workers` for one file would mean a second Vitest project,
`isolatedStorage: false` because WebSockets and Durable Objects are not supported
with it on, and a dependency whose isolated storage was removed and reinstated
across the Vitest 4 migration. It was not worth putting the deploy job's tests
behind that.

[jupiter]: https://dl.acm.org/doi/10.1145/215585.215706
[wave]: https://svn.apache.org/repos/asf/incubator/wave/whitepapers/operational-transform/operational-transform.html
[eg]: https://arxiv.org/abs/2409.14252
[figma]: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
[figma-code]: https://www.figma.com/blog/building-figmas-code-layers/
[obsidian]: https://obsidian.md/help/sync/troubleshoot
[relay]: https://github.com/No-Instructions/Relay
[notion]: https://www.notion.com/blog/how-we-made-notion-available-offline
[yjs]: https://github.com/yjs/yjs/blob/main/INTERNALS.md
[loro]: https://github.com/loro-dev/loro
[dt]: https://josephg.com/blog/crdts-go-brrr/
[sharedb]: https://github.com/share/sharedb
[sun]: https://arxiv.org/abs/1905.01517
[hard]: https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html
[interleave]: https://martin.kleppmann.com/2019/03/25/papoc-interleaving-anomalies.html
[yps]: https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md
[ydo]: https://github.com/napolab/y-durableobjects
