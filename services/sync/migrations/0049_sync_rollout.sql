create table sync_rollout (
  key   text primary key,
  value text not null
);

insert into sync_rollout (key, value) values ('mode', 'off');

create table sync_flips (
  user_id      text    not null references users(id) on delete cascade,
  at           integer not null,
  from_version integer not null,
  to_version   integer not null,
  why          text    not null,
  min          text
);
create index sync_flips_user on sync_flips (user_id, at);
create index sync_flips_at on sync_flips (at);
