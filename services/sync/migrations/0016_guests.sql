create table guests (
  id         text    primary key,
  name       text    not null,
  email      text,
  created_at integer not null
);

create index guests_email on guests(email);

create table guest_sessions (
  token_hash text    primary key,
  guest_id   text    not null references guests(id) on delete cascade,
  created_at integer not null,
  expires_at integer not null
);

create index guest_sessions_guest on guest_sessions(guest_id);

create table guest_members (
  space_id    text    not null references spaces(id) on delete cascade,
  guest_id    text    not null references guests(id) on delete cascade,
  role        text    not null check (role in ('write', 'read')),
  joined_at   integer,
  declined_at integer,
  created_at  integer not null,
  primary key (space_id, guest_id)
);

create index guest_members_guest on guest_members(guest_id);
create index guest_members_space on guest_members(space_id, created_at);
