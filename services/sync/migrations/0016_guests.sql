-- A guest: somebody a link let in, with no account behind them.
--
-- Sharing already had a way in for somebody with no Nib account, and it ended
-- at the emailed code: the address had to be proved before the space opened.
-- That is the right check for an invitation, which is written to an address, and
-- the wrong one for a link anybody may follow, where there is no address to
-- prove and asking for one is a sign-up in everything but name. So a link now
-- hands out a guest instead, and possession of the link is the whole of the
-- check - which is what the link already was.
--
-- A guest is not an account and is never one row away from being one. It has no
-- storage, no settings, no connector, nothing to publish, and it reaches exactly
-- the spaces its links granted; see `guestMayReach` in src/guests.ts, which is
-- where that is enforced. What it has is a name, so the other people in a note
-- see something better than "somebody" over a caret.
create table guests (
  id         text    primary key,
  -- What a caret and the Share sheet call them. Derived from the device the
  -- first time, the way the carets already name devices, and renameable in one
  -- tap; see `guestName`.
  name       text    not null,
  -- What a link that asks first asked for, unverified. It is a label and never
  -- a credential: the account that later proves this address takes over the
  -- memberships written under it, which is the one thing it is good for.
  email      text,
  created_at integer not null
);

-- Which guests said they were at an address, asked when somebody proves one.
create index guests_email on guests(email);

-- A guest's session, hashed at rest and expiring like an account's. It lives in
-- the same store on the device as an account's token, so a guest who closes the
-- tab and comes back is still the same guest with the same name.
create table guest_sessions (
  token_hash text    primary key,
  guest_id   text    not null references guests(id) on delete cascade,
  created_at integer not null,
  expires_at integer not null
);

create index guest_sessions_guest on guest_sessions(guest_id);

-- Which spaces a guest reached, and at what. The same two roles a member can be
-- given: a guest is a person in a space, and the role matrix does not care how
-- they got there.
--
-- `joined_at` is the whole of whether they are in. A link anybody may follow
-- sets it at once; a link that asks first leaves it null, and that row is the
-- request the owner answers - accepting sets it, declining stamps `declined_at`
-- so the page somebody is waiting on can say so rather than only stop waiting.
-- Taking a guest out afterwards deletes the row, which is what ends their
-- access on the next pass.
create table guest_members (
  space_id    text    not null references spaces(id) on delete cascade,
  guest_id    text    not null references guests(id) on delete cascade,
  role        text    not null check (role in ('write', 'read')),
  joined_at   integer,
  declined_at integer,
  created_at  integer not null,
  primary key (space_id, guest_id)
);

-- Every space one guest can reach, which is asked on every listing, and how
-- many guests a space has taken lately, which is what bounds a link's redemption.
create index guest_members_guest on guest_members(guest_id);
create index guest_members_space on guest_members(space_id, created_at);
