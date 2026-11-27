create table chat_blocks (
  user_id    text    not null references users(id) on delete cascade,
  blocked    text    not null,
  created_at integer not null,
  primary key (user_id, blocked)
);
create index chat_blocks_blocked on chat_blocks(blocked);

create table chat_reports (
  id         text    primary key,
  reporter   text    not null,
  chat_id    text    not null,
  space_id   text    not null,
  message_id text,
  reported   text    not null,
  reason     text    not null,
  body       text    not null default '',
  created_at integer not null,
  mailed_at  integer
);
create index chat_reports_reporter on chat_reports(reporter);
create index chat_reports_unmailed on chat_reports(created_at) where mailed_at is null;
