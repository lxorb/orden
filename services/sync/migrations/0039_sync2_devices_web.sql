create table devices (
  id           text    primary key,
  user_id      text    not null references users(id) on delete cascade,
  session_id   text,
  name         text    not null,
  platform     text    not null,
  public_key   text,
  app          text,
  created_at   integer not null,
  last_seen_at integer,
  revoked_at   integer
);
create index devices_user on devices(user_id);
create index devices_session on devices(session_id);

create table web_states (
  user_id    text    not null references users(id) on delete cascade,
  key        text    not null,
  fence      integer not null,
  version    integer not null,
  generation integer not null,
  size       integer not null,
  device_id  text    not null,
  at         integer not null,
  primary key (user_id, key)
);

create table web_chunks (
  user_id text    not null references users(id) on delete cascade,
  name    text    not null,
  size    integer not null,
  at      integer not null,
  primary key (user_id, name)
);

create table web_keys (
  user_id    text    not null references users(id) on delete cascade,
  device_id  text    not null references devices(id) on delete cascade,
  wrapped    text    not null,
  generation integer not null,
  primary key (user_id, device_id)
);

alter table spaces add column web_store text not null default 'global'
  check (web_store in ('global', 'space', 'site'));
