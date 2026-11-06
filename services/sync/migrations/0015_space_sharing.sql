create table space_members (
  space_id    text    not null references spaces(id) on delete cascade,
  email       text    not null,
  role        text    not null check (role in ('write', 'read')),
  invite_hash text    unique,
  expires_at  integer,
  joined_at   integer,
  created_at  integer not null,
  primary key (space_id, email)
);

create index space_members_email on space_members(email);

create table space_links (
  space_id   text    primary key references spaces(id) on delete cascade,
  token      text    not null unique,
  role       text    not null check (role in ('write', 'read')),
  mode       text    not null check (mode in ('open', 'approval')),
  created_at integer not null
);

create table space_requests (
  space_id   text    not null references spaces(id) on delete cascade,
  email      text    not null,
  role       text    not null check (role in ('write', 'read')),
  created_at integer not null,
  primary key (space_id, email)
);

create table mailed (
  email   text    primary key,
  sent_at integer not null
);
