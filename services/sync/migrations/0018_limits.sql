create table limits (
  scope text    not null,
  key   text    not null,
  count integer not null,
  until integer not null,
  primary key (scope, key)
);

create index limits_until on limits(until);

create table mailed_days (
  day   integer not null,
  email text    not null,
  primary key (day, email)
);
