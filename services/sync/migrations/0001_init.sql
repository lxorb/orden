create table users (
  id         text    primary key,
  email      text    not null unique,
  created_at integer not null
);

create table login_codes (
  email      text    primary key,
  code_hash  text    not null,
  salt       text    not null,
  expires_at integer not null,
  attempts   integer not null default 0,
  sent_at    integer not null
);

create table sessions (
  token_hash text    primary key,
  user_id    text    not null references users(id) on delete cascade,
  created_at integer not null,
  expires_at integer not null
);

create index sessions_user on sessions(user_id);

create table spaces (
  id             text    primary key,
  user_id        text    not null references users(id) on delete cascade,
  name           text    not null,
  created_at     integer not null,
  updated_at     integer not null,
  blog_enabled   integer not null default 0,
  blog_subdomain text    unique,
  blog_domain    text    unique,
  blog_title     text
);

create index spaces_user on spaces(user_id);

create table space_cursor (
  space_id text    primary key references spaces(id) on delete cascade,
  next     integer not null default 1
);

create table notes (
  id         text    primary key,
  space_id   text    not null references spaces(id) on delete cascade,
  path       text    not null,
  seq        integer not null,
  version    integer not null default 1,
  updated_at integer not null,
  deleted    integer not null default 0,
  size       integer not null default 0,
  hash       text    not null default ''
);

create unique index notes_live_path on notes(space_id, path) where deleted = 0;
create index notes_space_seq on notes(space_id, seq);
