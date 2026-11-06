alter table users add column avatar text;
alter table users add column pronouns text;
alter table users add column bio text;
alter table users add column status text;
alter table users add column accent text;
alter table users add column zone text;
alter table users add column hidden integer not null default 0;

create table presence (
  user_id text primary key references users(id) on delete cascade,
  state text not null check (state in ('active', 'away', 'offline')),
  at integer not null
);

create table space_nicks (
  space_id text not null references spaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  nick text not null,
  primary key (space_id, user_id)
);
create index space_nicks_user on space_nicks (user_id);
