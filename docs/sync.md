# Sync

Notes are files on a disk. Sync is the part that makes the same files be on every
disk, and the part that has to be trusted absolutely: an editor that loses a
paragraph once is an editor nobody uses again.

`docs/collaboration.md` is about two people in one note at the same second. This
is about the rest of it: what the account keeps, what happens when two devices
disagree, what a reader can see about any of it, and the two things that are about
the account rather than the notes.

## What a pass is

One space, two halves. Take what the account has moved on to, then offer what this
machine has. Neither half knows anything about the loop that calls them; see
`apps/desktop/src/lib/sync/mirror.ts` and `sync.svelte.ts`.

The thing that makes it cheap is a hash per note, kept from the last pass. A local
hash that no longer matches means the file changed here. A version that has moved
means it changed there. Both at once is the only case that needs a decision, and
that decision is the one below.

## Versions on the account

Every device already keeps its own history: a folder of snapshots, one every few
minutes while a note is being written in, swept after a week. That is the one a
reader reaches for, because it is instant, it goes back to before the note was
ever synced, and it costs nobody anything.

It has three holes, and they are all the same hole. It is keyed by the note's path
on that machine, so a rename orphans it. Another machine never sees it. And a
laptop that dies takes it with it.

So the account keeps versions too, keyed by the note's id, which is the one name
for a note that every device agrees on.

**What a version is: a body the account was sent.** Every push already carries the
whole note, so the versions are the pushes. Nothing is diffed, nothing is computed
and nothing is sent that was not being sent anyway. The body goes to R2 under its
own hash, so a note that flips between two states costs two objects however many
times it flips, and two notes that say the same thing cost one. The row is a
moment, a hash, a size, and the device that sent it.

Which device, for every way a note arrives: a pass pushing it, a note created, a
space put back, and a note settled in a room, which names the device that was
typing. Blank means nobody announced a name - the note a new space arrives with,
a connected app writing through the connector, a client that sends no header -
and the history sheet then shows the moment with nothing beside it, which is what
the device's own snapshots look like.

**At most one every five minutes.** The same interval the device's own keeper
defaults to. The newest state of a note is the note itself, so a version from
thirty seconds ago says nothing the file does not.

**A month, thinned to one an hour after the first day.** The same two rules the
device's sweep uses, so the two histories read alike, run by the nightly cron with
a write budget: a sweep that tried to catch up on a year in one invocation would
be stopped by the platform rather than by us.

The budget is spent a statement per note rather than a statement per row, which is
what makes those two rules true rather than aspirational. A note written in all day
is 288 versions, of which 264 are crowded, so a budget counted in rows spent a
whole night's on a single note - and with two busy notes the thinning never caught
up at all: every night began the same distance behind, and the month was whatever
had accumulated. A note now falls behind by at most one run of the sweep.

**And at most 1024 versions of any one note**, held where the version is written
rather than left to the sweep. A month under the two rules above comes to 984, so
nothing anybody does reaches this by accident; what it does is put a number on what
one note can cost, which a ceiling waiting on a nightly job cannot.

**There is no setting for it.** The only thing a longer month would change is the
bill for storage nobody asked to keep, and a reader who does not want their words
on the account has a clearer lever than a slider, which is not to sync. Version
bytes are also not counted against the account's quota: they are the service's
promise rather than the reader's allowance. Which is worth knowing the size of:
even with the ceiling above, an account at its 1 GiB quota can have a few hundred
times that behind it in version bodies, and nothing bills for them.

**One place to read them.** The note's own history sheet lists both, newest first,
with the device beside the ones the account holds. A save this device kept and then
pushed is one moment in two lists, and the device's copy wins, because reading it
costs nothing.

### Going back

One space, or one folder of it, to how it read at a moment. `Sync` in the settings
asks what would change before anything changes, and what it then writes is a new
version of every note that has moved since - so a rollback is an edit like any
other, undoable the same way, and nothing about it is special except how many
notes it touches at once.

A note written after that moment with no version at or before it is left alone:
there is nothing to put back. So is one whose body the sweep has already taken -
a row naming bytes that are gone answers nothing rather than answering with an
empty note, which is the one answer that would write over words somebody still
has.

One bound to know about: a rollback reaches 400 notes in a request, which is the
same per-invocation budget the sweep and the change feed have. A space with more
notes than that under the path named is put back 400 at a time, and neither the
dry run nor the answer says so yet - so the count the sheet shows is what this
request would do and not necessarily what the space holds.

Four hundred notes per request, because a Worker is bounded in writes. A space
with more than that says so rather than answering four hundred as though it were
the whole space, and the sheet asks again until there is nothing left; the number
it shows is the number of notes in all.

## When the same note was written twice

It happens for one reason: two devices had the note, and both changed it. Nothing
can decide which words the reader meant, so the only question is what the app does,
and `Sync` in the settings offers the three honest answers.

**Keep both copies** is what nib has always done, and the default. The other
device's copy lands beside the note as `Plan (from another device 2026-09-12).md`
and the reader sorts it out with the diff in front of them. Nothing is ever lost;
the cost is a second file in the list.

**Let the newest win** puts the later of the two in front of you. Which is only
safe because of what else is kept: the words that lose are in this device's own
history, and, if they were ever pushed, in the account's. So it means "show me the
newer one and keep the other where I can find it", not "throw one away". Which is
newer is the file's own timestamp against the account's; a platform that keeps no
timestamp - the browser, where a note is a row rather than a file - treats the
copy that travelled as the newer one.

**Ask me each time** leaves the note exactly as it is here, holds the other copy,
and says so quietly in the pane. The note is not pushed while it waits, because
pushing it is what would write over the copy nobody has looked at yet. Answering
touches only the files: letting go of the clash is what lets the next pass push, so
an answer costs no request and an answer given with the network down is still the
answer when it comes back.

A **canvas** is never any of these. Everything on one has an id and a time, so the
union of two copies keeps every card and every stroke either device drew, and both
sides compute the same merge; see `docs/canvas.md`.

The rule lives on the account, because it is a decision about the notes rather than
about the machine.

## What synced

The light in the corner says syncing, or failed. That is the right amount to say in
a corner and not enough to act on, so `Sync` lists the last few dozen passes: when,
which space, how many notes came down, how many went up, and what went wrong in the
server's own words.

Kept on the device, and only when there is something to say - a pass that moves
nothing is not written down. A log of "nothing happened" every twenty seconds is a
log nobody can read, and a table on the server would mean a write on every pass for
something almost nobody reads.

It goes when the session does. A note waiting to be settled is held whole, because
it is the copy the pass had in its hand, which makes this the one place on the device
where somebody else's words sit outside the vault - and the vault is emptied on
sign-out. Clearing the list by hand is the other thing, and that leaves what is
still waiting: a clash is work, not a log line.

The account's side of the same question is which device wrote a version, which the
history sheet already shows. The Worker's own failures go to Workers Logs with the
route, the error's name and the request's ray, and nothing about whose sign-in it
was; see `services/sync/src/failed.ts`, which is for whoever runs the service
rather than for whoever uses it.

## A second code when signing in

Signing in is an emailed code, which means whoever holds the mailbox holds the
account. That is fine for almost everybody and not fine for two cases worth taking
seriously: a mailbox that has been taken over, and one left signed in on a machine
somebody else uses.

So, in `Account`: ask for a code from an authenticator app as well. Six digits,
thirty seconds, the thing every authenticator app already does.

**Why not passkeys**, which are stronger and nicer to use: a passkey is bound to
one origin, and nib runs at `tauri://localhost` on the desktop, at
`http://127.0.0.1:<a fresh port every launch>` inside the glasses plugin, and at
its own domain on the web. There is no single relying party those three can agree
on, so a passkey would work on the web and refuse to exist on the other two. That
is not a second factor, it is a second class of reader.

How it is kept: the secret is encrypted under the service's own environment secret
with a derivation of its own, the way an OpenAI key is, so a leaked database is not
a drawer full of working authenticators. No secret configured means the pane offers
nothing rather than storing one in the clear.

**A code is spent the moment it works.** RFC 6238 says a verifier must not take the
same one twice, and the reason is the ninety seconds a code stays inside the drift
window: without this, one read over a shoulder, off a screen share or out of a
phishing page was a second sign-in as well as the first. What is written down is
the step the code was derived from, never the code.

Two ceilings on the guessing, both per hour: twenty codes for one account, and
sixty from one machine. The second is there because the first says nothing at all
to a script working through a list of addresses twenty guesses at a time.

**Recovery codes** are ten one-shot codes, hashed at rest and spent the moment they
work, shown once. Losing a phone is the common case and this is the only honest way
out of it. Ten bytes each, behind PBKDF2 salted with the account's own id - five
bytes under a single digest is forty bits, which is a table a graphics card walks
in minutes, so a leaked database would have been a way past the factor on every
account at once. Codes printed before that change still work; a row says which
scheme wrote it.

A hundred thousand rounds is a hundred thousand rounds, and the tests about the two
ceilings above spend a hundred derivations between them - which is most of a minute
of arithmetic nothing is measuring. So the cost has one knob, `costRecoveryLess` in
`second.ts`, and it is a function rather than a binding on the environment: a
binding is configuration, and a deploy that mistyped one would weaken every code at
rest without anybody writing a line of code. Nothing in the Worker calls it, the
test file that does says so in its first lines, and a test asserts the number the
Worker uses is still a hundred thousand.

Two operational facts worth writing down.

The secret the authenticator secrets are encrypted under is the service's, so
rotating it makes every enrolled authenticator stop verifying. The recovery codes
still work - they are hashed, not encrypted - so there is a way back in, but
everyone would have to enrol again. **An account that has spent all ten of its
recovery codes before such a rotation has no way back in at all**, because asking
for the second code is decided by whether the account has a factor and not by
whether the service can still read it - which is the right way round for security
and a dead end for that account. Rotating the secret means clearing `totp_at` and
`totp_secret` in the same breath.

An enrolment nobody finishes holds its secret in the clear for ten minutes, because
until a code proves an app has it there is nothing to bind it to. The nightly job
takes those rows away; before it did, closing the pane left a working secret in the
table for the life of the database.

### The sessions, which matter more

A session row used to say nothing but its own hash and when it expires. So "is
anybody else signed in as me" had no answer, and nothing could be done about it if
they were - which makes a second factor half a feature: it stops somebody getting
in and does nothing about somebody already inside.

Now each session says which device opened it and when it was last seen - written at
most once an hour, because what a reader wants to know is "today" or "in March" -
and any of them can be ended from `Account`, including every one but this.

## Syncing without the app

A repository of notes that publishes or mirrors from CI needs what the app needs
and nothing else: what changed, and a note written back.

There is already a credential for a program acting for somebody - the `nib_...`
token in `Settings > LLM access`, hashed at rest, read-only or read and write - and
it now reaches the sync routes as well as the connector: the change feed, a note's
words, a note created, a note written, a note's versions. Nothing else. Not the
account, not the sharing, not the trash, and not a delete: a script that can delete
is a script that can empty a space on a bad `if`, and nothing about publishing from
CI needs it.

The list is written as what is allowed rather than what is refused, so a route
added tomorrow is closed to a token until somebody says otherwise; see
`services/sync/src/programs.ts`. Every route on it asks its own question again
behind the door - which space, at what role - so the token opens the route and the
membership still decides the answer. Nothing about the second factor or the sessions
is on it: a credential in a CI secret that could see the sessions could end them,
and one that could reach the factor could take it off, which is the account
defending itself against exactly that credential leaking.

One thing the listing does hand over that the list above would not: `GET /v1/spaces`
answers with each space's blog settings, including the TXT value that proves a
domain. It is a verification nonce rather than a credential - using it means already
controlling the domain's DNS - but a token scoped to "notes and nothing about the
account" can read it, and so can a guest.

Then a script, `scripts/nib-sync.mjs`, forty lines of fetch:

```yaml
- name: Pull the notes
  run: node scripts/nib-sync.mjs pull "Work" ./notes
  env:
    NIB_TOKEN: ${{ secrets.NIB_TOKEN }}
```

`pull` writes every note into the folder and remembers the cursor in
`.nib-cursor`, so the second run asks only for what has changed and a deleted note
takes its file with it. `push` sends every note in the folder, creating what the
account does not hold and writing what it holds differently. A file missing from the
folder is never read as "delete it from the account": a checkout that failed half
way is not an instruction to empty a space.

**What is deliberately missing: a per-space scope.** The token is the account's, so
a job that can write one space can write them all. Narrowing it means a column and
a second pane, and that is a decision for whoever wants it rather than something to
guess at.

## What this costs

A version is one D1 row and, for a body nothing else already holds, one R2 object.
A month of a busy space of a thousand notes, at one version an hour for the notes
actually being written in, is tens of thousands of rows and a few hundred megabytes
of bodies - which at R2's prices is cents a month, and the sweep is what keeps it
from becoming a year of that.

The sweep, the rollback and the change feed are all bounded per invocation, in
writes rather than rows, because a Worker's ceiling is on writes.

## Tests

- `services/sync/test/versions.test.ts` - what is kept, what is not kept twice,
  what one body serves, the rollback with its dry run, and the sweep taking a body
  only once the last row naming it has gone.
- `services/sync/test/second.test.ts` - the RFC 6238 vectors, the enrolment that
  turns nothing on until a code proves it, the half-finished sign-in that cannot be
  finished twice but survives a mistyped code, an app's code spent the moment it
  works, a recovery code that is not a bare digest, both ceilings on the guessing,
  the abandoned enrolment the nightly job takes away, and the sessions a reader can
  see and end.
- `services/sync/test/programs.test.ts` - exactly which routes a token acting for
  somebody reaches, that a read-only one reaches none that write, and that neither
  the factor, the sessions nor a rollback is one of them.
- `services/sync/test/guests.test.ts` - and the same question for a guest, which
  reaches none of those either.
- `apps/desktop/src/lib/sync/conflicts.test.ts` - the rule read off the account and
  where the other copy goes.
- `apps/desktop/src/lib/sync/mirror.test.ts` - the pass itself, including the three
  rules.
- `apps/desktop/test/e2e/sync.py` - all of it against `wrangler dev`: a note pushed
  and its history read back, the rollback, the rule chosen in the pane and read off
  the account, the log, a second factor turned on with a code the drive works out
  itself, and `nib-sync.mjs` pulling the space into a folder.
