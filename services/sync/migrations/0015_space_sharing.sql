-- Sharing a space: who else may reach it, the link that lets somebody ask, and
-- the requests waiting on the owner.
--
-- A membership is keyed by an email address rather than by an account, because
-- the person being invited may not have one yet. Accounts are keyed by the same
-- address and there is exactly one address per account (see 0009), so the two
-- meet on their own: a row written today is already theirs on the day they
-- prove the address. Nothing has to be migrated when they sign up, and nothing
-- has to be reconciled if they never do.
--
-- The owner is not a row here. A space already says who owns it, and one owner
-- is what `owner` means; a second copy of that fact is a second thing to keep
-- true.
create table space_members (
  space_id    text    not null references spaces(id) on delete cascade,
  -- Lower case, as `normaliseEmail` writes it, so one address is one member.
  email       text    not null,
  role        text    not null check (role in ('write', 'read')),
  -- The invitation that was sent, and how long its link stays good for. The
  -- link is a way in rather than the way in: what actually opens the space is
  -- the address being proved by the same emailed code the app signs in with.
  -- So an expired link costs nothing but the shortcut.
  invite_hash text    unique,
  expires_at  integer,
  -- When they first came in. Null while nobody has, which is what the sheet
  -- shows as pending.
  joined_at   integer,
  created_at  integer not null,
  primary key (space_id, email)
);

-- Every space one address can reach, which is asked on every listing.
create index space_members_email on space_members(email);

-- The share link, one per space. Its role says what it hands out and its mode
-- says whether it hands it out at all: `open` lets anybody who proves an
-- address in, `approval` turns the same link into a request the owner answers.
--
-- The token is stored as it is rather than hashed, unlike every other secret
-- here, because the owner has to be able to copy the link again tomorrow and a
-- hash cannot be read back. Revoking is deleting the row, which is why there is
-- no revoked_at: a link that no longer opens anything is not worth keeping.
create table space_links (
  space_id   text    primary key references spaces(id) on delete cascade,
  token      text    not null unique,
  role       text    not null check (role in ('write', 'read')),
  mode       text    not null check (mode in ('open', 'approval')),
  created_at integer not null
);

-- Somebody who followed an `approval` link and proved their address. The role
-- is the one the link offered, kept here so that changing the link afterwards
-- does not change what a waiting request was promised.
create table space_requests (
  space_id   text    not null references spaces(id) on delete cascade,
  email      text    not null,
  role       text    not null check (role in ('write', 'read')),
  created_at integer not null,
  primary key (space_id, email)
);

-- When an address was last written to about sharing, so that neither an
-- invitation nor a join-request notice can be used to send somebody mail on
-- demand. The same thirty second gap the sign-in code keeps, and kept per
-- address for the same reason: it is the person receiving it who is protected.
create table mailed (
  email   text    primary key,
  sent_at integer not null
);
