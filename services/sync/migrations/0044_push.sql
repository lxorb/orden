create table push_targets (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  device_id text,
  kind text not null check (kind in ('fcm', 'apns', 'webpush')),
  token text not null,
  keys text,
  zone text,
  created_at integer not null,
  failed_at integer,
  unique (user_id, token)
);
create index push_targets_user on push_targets (user_id);

create table push_reminders (
  note_id text not null,
  id text not null,
  user_id text not null,
  space_id text not null,
  at integer not null,
  title text not null,
  body text not null,
  path text not null,
  hash text not null,
  line integer not null,
  sent_at integer,
  primary key (note_id, id)
);
create index push_reminders_due on push_reminders (at) where sent_at is null;
create index push_reminders_user on push_reminders (user_id);
