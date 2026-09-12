-- A second factor, and sessions somebody can see and end.
--
-- Signing in is an emailed code, which means whoever holds the mailbox holds
-- the account. A second factor is worth having exactly where that is not enough:
-- a mailbox that has been taken, or one left open on a machine somebody else
-- uses. It is a code from an authenticator app - the secret never leaves the
-- account, nothing is mailed, and every platform nib runs on can show six boxes.
--
-- The secret is encrypted at rest with the same envelope the OpenAI key uses
-- (see ask/key.ts): a leaked database is not a set of working authenticators.
--
-- Recovery codes are hashed like every other one-shot secret here, and spent the
-- moment they work, the way a share link is.
--
-- And the other half, which matters more than the factor: a session row had no
-- name, no id and no record of being used, so nobody could answer "is anyone
-- else signed in as me" or do anything about it. Now each says what device
-- opened it and when it was last seen, and carries an id a client can name
-- without holding the token.
alter table users add column totp_secret text;

-- When it was turned on, which is also what says it is on.
alter table users add column totp_at integer;

create table recovery_codes (
  user_id text not null references users(id) on delete cascade,
  code_hash text not null,
  used_at integer,
  primary key (user_id, code_hash)
);

alter table sessions add column id text;
alter table sessions add column name text not null default '';
alter table sessions add column last_used_at integer;

-- Every row that was there before this gets a handle too, so a session opened
-- last month can be ended like any other.
update sessions set id = lower(hex(randomblob(8))) where id is null;

create index sessions_id on sessions(id);
