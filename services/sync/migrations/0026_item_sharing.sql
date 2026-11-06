create table space_members_2 (
  space_id    text    not null references spaces(id) on delete cascade,
  email       text    not null,
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

create index space_members_email on space_members(email);
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
