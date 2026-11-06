create table blobs (
  hash       text    not null,
  user_id    text    not null references users(id) on delete cascade,
  size       integer not null,
  type       text    not null,
  created_at integer not null,
  primary key (hash, user_id)
);

create index blobs_user on blobs(user_id);
