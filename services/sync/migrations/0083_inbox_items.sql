create table inbox_items (
  user_id text    not null references users(id) on delete cascade,
  id      text    not null,
  fields  text    not null,
  stamps  text    not null,
  seq     integer not null,
  at      integer not null,
  by      text,
  primary key (user_id, id)
);
create index inbox_items_seq on inbox_items(user_id, seq);

create table inbox_cursor (
  user_id text    primary key references users(id) on delete cascade,
  next    integer not null default 1
);
