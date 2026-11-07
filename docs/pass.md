# Pass

A password manager inside Orden, laid out the way Proton Pass is so a reader who
knows Proton Pass finds everything where they look for it (#236). Orden's own look,
none of Proton's names, marks or pictures.

Emil, 2026-11-06: _"I want a full fledged password manager integrated into orden.
Working flawlessly. I am a big fan of proton pass, so please copy every single
feature and functionality that they have ... and to have our UI structured in the
same way as them so that I will find anything."_ And from the issue itself: _"auto
login feature (that automatically logs you in for a website if there is exactly one
matching credential in your password manager -> should work even for multi page auth
workflows"_.

## Where it is

**A Pass tab**, kind `pass`, opened from the palette (**Pass**), the new-tab card and
its key. It has no file: the tab's `doc` holds only which vault, item and view are
shown, never a secret. Three columns, as Proton Pass has them:

1. **The side**: **New item** (Login, Alias, Card, Note, Identity, Other with its
   templates, and Password, which is the generator), **Vaults** (All items, each vault
   with its colour, mark, count, folders and a menu: Edit, Share, Manage access,
   New folder, Move all items, Leave, Delete; then New vault), **Trash**, **Shared**
   (Shared with me, Shared by me, Secure links), **Monitor**, and at the foot
   **Settings** and **Lock**.
2. **The list**: a search field scoped to what the side has chosen, the type filter
   (All, Logins, Aliases, Cards, Notes, Identities, Other) with counts, the sort (Most
   recent, Title A-Z, Newest, Oldest), the Pinned strip, and the rows (the site's mark
   or the kind's, the title, the username, the card's last four, the note's first
   line). A bulk mode selects rows for Move, Trash, Restore and Delete.
3. **The item**: the title and its vault, Edit, Share and a menu (Pin, Move to,
   Duplicate, History, Exclude from Monitor, Move to trash; in the trash Restore and
   Delete permanently). Every field is a row with Copy, and a hidden one with Show.
   A 2FA code counts down in a ring. Under the fields: websites, the note, extra
   fields, attachments, and created, modified and last used.

Editing happens in the third column, as in Proton Pass. Monitor and Settings take the
second and third columns.

## What an item is

`packages/pass/src/types.ts`. Every kind has a title, a note and extra fields (text,
hidden, 2FA, date). Login: email, username, password, 2FA secret, websites (each with
how it matches: the site and its subdomains, the exact host, the exact address, an
address it starts with, or never) and passkeys. Alias, Card, Note, Identity (personal,
address, contact and work, each with its optional fields, plus sections of the
reader's own), Custom (from a template or from nothing), SSH key and WiFi.

What the account could read about an item is its vault, its id, its revision and when
it was written. Everything else - the kind, the title, the trash, the pin, the folder -
is inside the sealed envelope (`Envelope`). A word a newer version wrote that this one
does not know is read as the nearest it knows, and a field of a kind it does not know
is read as hidden, never shown.

## Keys

Nothing is written down that the account, the disk or another program could read.
Everything is WebCrypto (AES-256-GCM, HKDF-SHA256, ECDH and ECDSA P-256, SHA-256) and
`@noble/hashes`' Argon2id, which is audited; Orden writes no cipher of its own.

- **The root key**, 32 random bytes, made on the first device. It opens everything
  else and is only ever kept sealed:
  - under the **Pass password**: Argon2id (64 MiB, 3 passes, 1 lane, 16 byte salt)
    stretches it to 32 bytes, HKDF makes the sealing key. The seal also names the
    keyring's public key and when the password was set, so a password seal cannot be
    moved onto another keyring. This is how a new device opens the reader's Pass, and it
    is Proton Pass's extra password. A keyring the account hands over that asks for more
    than 256 MiB or 10 passes is not stretched at all: Pass says so instead of spending
    the device's memory on it. A seal made before it named the keyring still opens, and
    is made again the next time the password opens it;
  - under the **recovery key**, 32 random bytes shown once as a code in groups (the
    emergency kit), for a forgotten password;
  - on this device only, for **PIN** and **device** unlock: under a key made from a
    secret in the system's secret store (`pass-device`), and for a PIN also from
    Argon2id of the PIN. Each PIN is counted before it is tried, one at a time
    and inside one write of the device store, so windows trying at once cannot pass five
    between them; the fifth wrong one forgets the PIN's seal, and only the password
    opens it then. The count only stops someone at the device: a program running as the
    reader can read the system's secret and the seal and try every PIN on its own, which
    Settings says beside the PIN. The browser build keeps its secrets in IndexedDB, so
    there it offers the password only.
- **The root key never changes.** A new password or a new recovery key seals the same
  root again, so an old password or an old recovery key still opens a copy of the
  keyring somebody kept from before (Settings says so beside both). Pass has no way to
  start over with a new root yet; that would mean sealing every vault key and every
  item again under keys nobody had before.
- **The reader's pair**: an ECDH P-256 key pair, its private half sealed under the root
  key. Vault keys are wrapped to it (ephemeral ECDH, HKDF with both public keys as salt,
  AES-256-GCM), which is how a vault shared by someone else reaches the reader. The
  wrapping says nothing about who wrapped: the account could wrap a key of its own.
- **The reader's signing pair**: an ECDSA P-256 key pair, its private half sealed under
  the root key (`sign`), its public half in the keyring next to the other. The account
  never lets it change once it is set. A keyring from before it existed gets one the
  first time it is unlocked, and sends it. A person's **safety code** is the first 16
  bytes of the SHA-256 of both their public keys.
- **A vault's key**, 32 random bytes, wrapped to each member's public key, the owner's
  too. It seals the vault's name, colour, mark and folders. Each key version comes with
  a **proof**: whoever made it signs the vault's id, the key version, the SHA-256 of the
  key and their own signing key (`packages/pass/src/trust.ts`). A device takes a vault
  only when the reader made it or accepted it, and then signs that it did, naming the
  owner it trusts (`accepted`, kept with the reader's membership, so the reader's other
  devices trust the same owner). A new key version is taken only when its proof is
  signed by that owner, by an owner they handed the vault on to (each hand-over is
  signed by the owner before), or by a manager one of them vouched for (signed when
  they made them manager). A key version lower than the one held, another key under the
  same version, a vault nobody accepted, or a key nobody of these signed is left out,
  the device keeps what it had, and Pass says so in one line under the side. While Pass
  is locked such a change waits for the next unlock, so it can be checked first.
- **An item's key**, 32 random bytes, sealed under its vault's key. It seals the item's
  envelope, which names the vault, the item, the key version and a revision of its own
  as additional data; the revision is also written in front of the seal, so a device
  can see without any key that the account sent an older copy of an item than the one it
  holds, and refuses it. Items sealed before they carried a revision still open, and get
  one the next time they are written. Older versions are sealed apart (`version`), under
  their own revision, so the account cannot pass one off as the item. Sharing one item
  or making a secure link hands over an item key, never a vault key.
- **A secure link's key** lives in the link's `#` and never reaches the account.

Every seal names what it is (`label`) and where it belongs (the vault's and the item's
ids) as additional data, so a sealed item moved by the account into another vault, or
an item key swapped for another's, does not open: it is refused, not shown wrong.

Unlocked keys live in memory only, the items too. Locking drops them all; the next
unlock opens them again. It locks after the time chosen in Settings > Security (1, 2,
5, 10 or 60 minutes away from the app, or when Orden closes; 10 by default), when the
system locks or sleeps, and on **Lock**. A copied secret is cleared from the clipboard
after the time chosen there (15 seconds, 1 minute, 2 minutes or never; 1 minute by
default) if the clipboard still holds it.

## Where it is kept

Each device keeps the sealed rows in IndexedDB (`orden-pass`): the keyring, the vaults,
the items and their versions, and what has not been sent. Pass works without an Orden
account; signing in sends what is there to the account and takes what the account has.

The account (`/v2/pass`, `services/sync/src/pass`) keeps the same sealed rows, the
members of each vault and their roles, the pending invitations and the secure links. A
write names the revision it read and is refused over a newer one; the device then meets
the two field by field against the version both last agreed on, and writes again. Each
write tells the account's hub, and the reader's other devices and the vault's members
read again within a second. Against an older account without the routes, nothing is
sent or taken, and what is on the device stays there.

## Aliases

Settings > Aliases connects SimpleLogin or addy.io with the reader's API key, kept sealed
under the root key on this device only, like the Have I Been Pwned key. A new alias is made
at the service from a prefix, one of its suffixes or domains and a mailbox, and kept as an
Alias item; a sign-up form in a web tab can ask for one the same way. The item shows the
address, the mailboxes it forwards to and what it did lately (the last 14 days on
SimpleLogin, every day on addy.io), and its switch turns forwarding on and off at the
service. An alias moved to the trash is turned off there, as Proton Pass does. Webviews
reach both services directly: both answer cross-origin requests.

## Attachments

Each file gets a key of its own, 32 random bytes, sealed under the item's key and kept in
the item's envelope with the file's name, type and size. The file is sealed under it in
parts of 4 MiB (AES-256-GCM, each part naming the item, the file and, past one part, its
number), at most 100 MiB a file. The device keeps the sealed parts in IndexedDB (`files`)
and sends them after the item (`PUT /v2/pass/files/:vault/:item/:file?part=&parts=`); a
member reads them back (`GET`, viewer and up), an editor writes and deletes them, and they
count against the uploader's storage. Deleting the item or its vault deletes its files;
moving the item to another vault takes them along and seals their keys again under the
item's new key. Another device fetches a file the first time it is opened.

## SSH keys and passkeys

An SSH key item can make an Ed25519 key with WebCrypto: the public key in OpenSSH's one
line and the private key in OpenSSH's own format (unencrypted, as `ssh-keygen -N ''`
writes it). Its view shows the key's SHA256 fingerprint. Pasting a private key fills in
its public half. A login lists its passkeys (site, user, made) and can remove one; passkeys
come in from Proton Pass and Bitwarden exports.

## Sharing

A vault is shared with somebody by their email address, as a **viewer** (reads),
an **editor** (writes items and makes secure links), a **manager** (also invites,
confirms, changes roles and removes people) or its one **owner** (also hands the vault
on; the owner cannot leave until they have). `apps/desktop/src/lib/pass/share.ts`.

- **Safety code**: the account hands out the public keys, so a person's keys have a
  safety code (both keys, the first 16 bytes of their SHA-256, in groups of four) that two
  people read to each other to be sure the keys are really the other's. A device keeps
  the keys it first saw for each address (`people`, on this device only); keys that
  differ later are refused with a warning until the reader checks the code again.
- **Inviting**: Pass asks the account for the invitee's keys and shows their safety
  code: the code of the very keys it would wrap the vault's key to. Only once the reader
  presses **Codes match** does the invitation carry the key; otherwise it waits without
  one, and a manager **confirms** them later, after checking the code. If they have no
  account or no Pass yet, it waits the same way. The invitation also carries who the
  inviter trusts as owner, and the owner's vouch for the inviter when they are a
  manager; the invitee sees the inviter's safety code, and accepting checks that the
  vault's key proof is signed by that owner, then signs `accepted`. The invitee sees the
  vault's name before accepting, but the vault joins their Pass only once they accept.
- **Removing somebody** renews the vault's key: a new key is wrapped to everybody who
  stays whose keys match what this device knew (first seen counts; a member whose keys
  changed goes back to waiting to be confirmed), every item gets a new key of its own and
  its envelope is sealed again under it, its attachments' keys with it, the vault's name
  and folders are sealed again, and the proof is signed, all in one write the account
  refuses unless it covers the owner, whoever renews it, and every item at the revision
  it was read at. The device seals its own older versions again under the new item keys;
  the account forgets the versions it kept, sealed under the old ones. What the removed
  person kept from before stays readable to them; nothing written after is, even with
  the account's help. Only the owner, an owner after a hand-over, or a manager the owner
  vouched for can renew a key; Pass refuses before it removes anybody otherwise.
  Leaving a vault is removing oneself.
- **Handing a vault on**: the owner signs a hand-over to the heir's signing key; the
  account keeps the hand-overs in order, and every member's device follows them from the
  owner it trusts.
- **Roles are the account's to keep.** Viewer, editor and manager are rules the account
  enforces on what it is sent. They are not seals: everybody in a vault holds its key,
  so a viewer's device could read every field and, with the account's help, write items
  the others would open. Only who may renew the vault's key is held by signatures. A
  vouch cannot be taken back: a manager the owner once vouched for, or a former owner,
  could still sign a new key the others take, if the account helps them.
- **An item deleted on another device** leaves its last copy on this one for 30 days,
  without its attachments (the account deletes those with the item), under **Deleted on
  another device** in the trash, where it can be restored as a new item.
- **Hide passwords from viewers** is a rule of the app, not a seal: a viewer holds the
  vault's key, so their device could read everything. The app keeps to it by showing a
  viewer neither the hidden fields nor the 2FA codes nor a WiFi network's QR code, and
  by leaving Duplicate and History out of their item menu.
- Sharing one item on its own is not there yet; a secure link hands over one item.

## Secure links

A secure link shows one item to anybody who has the link, without an account, for an
hour, a day, a week, two weeks or thirty days, and if asked for only so many views (at
most 100). The item is sealed under a new key for the link, without its attachments
and without its passkeys' private keys. The key goes in the address after the `#`,
which a browser never sends, so the account keeps only what it cannot open. The
account counts the views and forgets the sealed item when the link expires or is used
up; its maker can list their links and delete them, one by one or all the expired ones.
`apps/desktop/src/lib/pass/links.ts`.

The page the link opens (`apps/desktop/pass-link.html`) is its own small page: it reads
the key from the address and takes it out of the history at once, asks the account
for the sealed item, and shows its fields with Copy and Show, when it expires and how
many views are left. It loads nothing but its own script and style, under a policy
that allows nothing else, and it is in English only.

## In a web tab

Orden's own page script (the `nib` world, docs/web-tabs.md) finds sign-in and sign-up
forms, card and address forms, and 2FA fields. It reads nothing the page wrote except
what a person typed into a form they sent, and only to offer to keep it.

- **Filling**: a field Pass can fill wears a small mark. Pressing it, or Ctrl+Shift+L,
  shows Pass's choices for this site in Orden's own bubble under the address bar, where
  the page cannot reach. Choosing one fills the fields in the frame it is for.
- **Which site**: the frame's origin as the engine reports it, never as the page says.
  A login matches by its websites' rules (by default the site and its subdomains, the
  registrable domain worked out from the public suffix list). Nothing is filled into a
  page that is not `https` (or the machine itself), into a frame from another site than
  the page unless the login names that frame's site, or into a field that cannot be seen.
- **Saving**: a form sent with a password the item does not hold asks _Save login?_ or
  _Update password?_ in the same bubble. A sign-up form offers a generated password and
  an alias.
- **Signing in by itself**: with **Sign in automatically** on (Settings > General), a
  page whose site has exactly one matching login is filled and sent, then the next page
  of the same sign-in (the password after the username, the 2FA code after the
  password) is filled and sent as it appears, for up to two minutes. It never sends the
  same page twice in a row, so a wrong password stops it rather than looping; Escape or
  the bubble's **Stop** stops it, and a site can be left out.
- **Excluded sites**: per site, autofill, 2FA autofill, suggestions, saving and passkeys
  can each be turned off (Proton Pass's pause list).

## Agents

No agent verb, MCP tool, CLI verb or AI context reads Pass. An agent driving a web tab
never sees a password field's value. An agent may ask to sign in on a site; the reader
is asked in the bubble, and Pass fills the form itself, so the secret never passes
through the agent.

## Monitor

On the device: weak passwords (an estimate of the guesses it takes), reused passwords
(and where), inactive 2FA (a login with no 2FA code on a site known to offer it), and
excluded items. **Compromised passwords** asks Have I Been Pwned's range API with the
first five hex digits of the password's SHA-1 and padding, so neither the password nor
its hash leaves the device (k-anonymity), and only when the reader turns it on. Watching
email addresses for breaches needs a paid HIBP key; the reader can enter one.

## Import and export

From Proton Pass (zip, csv; the PGP export is asked to be decrypted first), Bitwarden
(json, csv), 1Password (1pux, 1pif, csv), LastPass, Chrome, Edge, Brave, Firefox,
Safari and Apple Passwords, KeePass (xml) and KeePassXC (csv), Dashlane (csv, zip),
Keeper (json, csv), RoboForm, NordPass, Enpass (json), Kaspersky (txt) and any csv with
a header Orden can read. Each import ends with a report of what came in and what could
not. Export: a file sealed with a passphrase (Argon2id and AES-256-GCM), plain JSON, or
CSV of the logins, after the Pass password is typed again. Only the vaults the reader owns
are exported; a vault shared with them stays with its owner. A CSV cell that starts with
`=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` in front, so a spreadsheet does
not run it as a formula.

## The code

| Where | What |
| --- | --- |
| `packages/pass` | Pure, no DOM: the item model, the seals and keys, the generator, 2FA codes, strength, address matching, import, export, Monitor's rules, merging, and the wire shapes the app and the Worker meet at |
| `apps/desktop/src/lib/pass` | The store, the device's rows, locking, the clipboard, the tab and its parts, autofill's half in the app |
| `apps/desktop/src-tauri/src/web_pass.rs`, `web_pass.js` | The page script and its channel on each engine |
| `services/sync/src/pass` | The account's routes |
| `apps/desktop/pass-link.html`, `apps/desktop/src/lib/pass/link-page.ts` | The page a secure link opens |

## Credits

- The memorable passwords' words are the EFF's large word list, CC BY 3.0 US.
- The sites known to offer 2FA are 2fa.directory's list, MIT, Copyright (c) 2021 2factorauth and Contributors.
