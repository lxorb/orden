create table pad_updates (
  seq     integer primary key autoincrement,
  user_id text    not null references users(id) on delete cascade,
  body    text    not null,
  at      integer not null,
  by      text
);
create index pad_updates_user on pad_updates(user_id, seq);
