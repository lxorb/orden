create table space_blobs (
  space_id   text    not null references spaces(id) on delete cascade,
  hash       text    not null,
  created_at integer not null,
  primary key (space_id, hash)
);
