create table ai_vaults (
  user_id    text    primary key references users(id) on delete cascade,
  rev        integer not null,
  blob       text    not null,
  auth_hash  text    not null,
  updated_at integer not null
);

create table ai_devices (
  user_id     text    not null references users(id) on delete cascade,
  id          text    not null,
  name        text    not null,
  commitment  text    not null,
  nonce       text,
  nonce_from  text,
  pub         text,
  revealed    text,
  wrapped     text,
  created_at  integer not null,
  approved_at integer,
  primary key (user_id, id)
);
