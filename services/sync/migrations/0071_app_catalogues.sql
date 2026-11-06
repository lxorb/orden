create table app_catalogues (
  user_id   text    not null references users(id) on delete cascade,
  device_id text    not null,
  at        integer not null,
  body      text    not null,
  primary key (user_id, device_id)
);
