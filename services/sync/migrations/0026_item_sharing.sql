-- Sharing one thing out of a space rather than the whole of it.
--
-- A share used to be about a space, because a space was the only unit there
-- was: notes belong to one, publishing is a property of one, and everything
-- keyed by a space id meant "everything in here". But a space is the drawer, and
-- what people hand each other is a note. Asking somebody to make a space to
-- share one plan with one person is asking them to reorganise their writing to
-- fit the wire.
--
-- So the four tables sharing already has grow one column: the thing the share is
-- about. Empty means the space, exactly as every row written until today; a note
-- id means that one file and nothing else around it. Nothing else changes - the
-- roles are the same two roles, an invitation is still an address, a link is
-- still a link, a guest is still a guest, and the ceilings still count against
-- the space's owner. A second set of tables would have been a second set of
-- routes, a second sheet and a second way to get any of it wrong.
--
-- Empty rather than null, which is what "no item" would read as in prose. A key
-- has to say when two rows are the same row, and SQLite does not treat one null
-- as equal to another: `(space, email, null)` twice is two rows, so an
-- invitation sent twice would be two memberships and the upsert behind it would
-- never fire. The empty string is a value, and one no note id can be.
--
-- The column goes into the primary key of each table, which SQLite cannot be
-- asked to change in place: each table is built beside the old one, copied,
-- and put in its place. The indexes go with the old tables and are written
-- again underneath.

create table space_members_2 (
  space_id    text    not null references spaces(id) on delete cascade,
  email       text    not null,
  -- The note this membership is about, or empty for the whole space.
  item        text    not null default '',
  role        text    not null check (role in ('write', 'read')),
  invite_hash text    unique,
  expires_at  integer,
  joined_at   integer,
  created_at  integer not null,
  primary key (space_id, email, item)
);

insert into space_members_2
    (space_id, email, item, role, invite_hash, expires_at, joined_at, created_at)
  select space_id, email, '', role, invite_hash, expires_at, joined_at, created_at
    from space_members;

drop table space_members;
alter table space_members_2 rename to space_members;

-- Every space one address can reach, which is asked on every listing.
create index space_members_email on space_members(email);
-- And every file one address was given on its own, which is the other listing:
-- the "Shared with you" section at the foot of the switcher.
create index space_members_item on space_members(item) where item <> '';

create table space_links_2 (
  space_id   text    not null references spaces(id) on delete cascade,
  item       text    not null default '',
  token      text    not null unique,
  role       text    not null check (role in ('write', 'read')),
  mode       text    not null check (mode in ('open', 'approval')),
  created_at integer not null,
  primary key (space_id, item)
);

insert into space_links_2 (space_id, item, token, role, mode, created_at)
  select space_id, '', token, role, mode, created_at from space_links;

drop table space_links;
alter table space_links_2 rename to space_links;

create table space_requests_2 (
  space_id   text    not null references spaces(id) on delete cascade,
  email      text    not null,
  item       text    not null default '',
  role       text    not null check (role in ('write', 'read')),
  created_at integer not null,
  primary key (space_id, email, item)
);

insert into space_requests_2 (space_id, email, item, role, created_at)
  select space_id, email, '', role, created_at from space_requests;

drop table space_requests;
alter table space_requests_2 rename to space_requests;

create table guest_members_2 (
  space_id    text    not null references spaces(id) on delete cascade,
  guest_id    text    not null references guests(id) on delete cascade,
  item        text    not null default '',
  role        text    not null check (role in ('write', 'read')),
  joined_at   integer,
  declined_at integer,
  created_at  integer not null,
  primary key (space_id, guest_id, item)
);

insert into guest_members_2
    (space_id, guest_id, item, role, joined_at, declined_at, created_at)
  select space_id, guest_id, '', role, joined_at, declined_at, created_at
    from guest_members;

drop table guest_members;
alter table guest_members_2 rename to guest_members;

create index guest_members_guest on guest_members(guest_id);
create index guest_members_space on guest_members(space_id, created_at);
