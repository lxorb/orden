-- The reader's AI accounts, carried end to end between their devices (docs/ai.md,
-- "Every device"). The account holds only ciphertext: `ai_vaults.blob` is sealed on a
-- device with the vault key, and `ai_devices.wrapped` is that key sealed to one device's
-- public key, written by a device that already has it when the reader allows the new
-- one. `rev` is what a write names, so two devices writing at once cannot lose each
-- other's change.
create table ai_vaults (
  user_id    text    primary key references users(id) on delete cascade,
  rev        integer not null,
  blob       text    not null,
  updated_at integer not null
);

create table ai_devices (
  user_id     text    not null references users(id) on delete cascade,
  id          text    not null,
  name        text    not null,
  pub         text    not null,
  wrapped     text,
  created_at  integer not null,
  approved_at integer,
  primary key (user_id, id)
);
