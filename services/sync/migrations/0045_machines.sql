alter table users add column online integer not null default 0;

create table machines (
  id text primary key,
  user_id text not null unique references users(id) on delete cascade,
  state text not null default 'asleep'
    check (state in ('asleep', 'starting', 'awake', 'stopping')),
  size text not null default 'small',
  region text not null default 'eu',
  image text not null default '',
  created_at integer not null,
  woke_at integer,
  slept_at integer,
  home_bytes integer not null default 0,
  backup_at integer,
  backup_key text,
  backup text,
  snapshot text,
  snapshot_at integer,
  snapshot_image text,
  held text,
  keep_awake integer not null default 0
);

create table machine_usage (
  user_id text not null,
  month text not null,
  awake_s integer not null default 0,
  cpu_s real not null default 0,
  mem_gib_s real not null default 0,
  disk_gb_s real not null default 0,
  egress_bytes integer not null default 0,
  primary key (user_id, month)
);
create index machine_usage_month on machine_usage (month);

create table machine_events (
  id integer primary key autoincrement,
  machine text not null,
  at integer not null,
  kind text not null,
  who text,
  device text,
  detail text
);
create index machine_events_machine on machine_events (machine, at);
create index machine_events_at on machine_events (at);

create table term_sessions (
  term text primary key,
  machine text not null,
  session text not null unique,
  user_id text not null,
  typing text not null default 'owner' check (typing in ('owner', 'writers')),
  created_at integer not null,
  ended_at integer
);
create index term_sessions_machine on term_sessions (machine);
create index term_sessions_user on term_sessions (user_id);

create table online_service (
  key text primary key,
  value text not null
);
insert into online_service (key, value) values
  ('online', 'off'),
  ('ceiling', '30'),
  ('admin', '78180341-d10b-4bea-92dc-f327035ebfac');

update users set online = 1 where id = '78180341-d10b-4bea-92dc-f327035ebfac';
