create table ai_accounts (
  user_id    text    primary key references users(id) on delete cascade,
  rev        integer not null,
  sealed     text    not null,
  updated_at integer not null
);
