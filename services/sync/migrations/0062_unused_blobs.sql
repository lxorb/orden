create table unused_blobs (
  user_id text not null,
  hash text not null,
  since integer not null,
  primary key (user_id, hash)
);

create index unused_blobs_since on unused_blobs(since);
