create table leftovers (
  what  text    primary key,
  since integer not null
);

create index leftovers_since on leftovers(since);
