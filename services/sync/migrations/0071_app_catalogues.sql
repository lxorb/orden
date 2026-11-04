-- What each of an account's computers has installed, for New application's chooser
-- (issue 1063, step 3): one row per device, the list its host wrote last, names, ids and
-- small icons as JSON. Written by the device for itself and read by the account's other
-- devices; gone with the device when it is ended, and with the account. See
-- src/apps/catalogue.ts.
create table app_catalogues (
  user_id   text    not null references users(id) on delete cascade,
  device_id text    not null,
  at        integer not null,
  body      text    not null,
  primary key (user_id, device_id)
);
