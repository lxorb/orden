create table time_entries (
  user_id text    not null references users(id) on delete cascade,
  kind    text    not null,
  id      text    not null,
  value   text,
  seq     integer not null,
  at      integer not null,
  by      text,
  primary key (user_id, kind, id)
);
create index time_entries_seq on time_entries(user_id, seq);

create table time_cursor (
  user_id text    primary key references users(id) on delete cascade,
  next    integer not null default 1
);
