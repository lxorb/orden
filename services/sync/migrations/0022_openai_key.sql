-- The account's OpenAI key, written and never read back.
--
-- It used to live in the settings blob as `glassesKey`, in the clear, and the
-- settings read handed it back to whoever asked with the session: the plugin took
-- it from there and called api.openai.com itself. That is one plaintext credential
-- in a column, one more origin on the plugin's network whitelist, and a key that
-- can be read by anything that can read the settings.
--
-- Emil's rule instead: "it stays in the account, but after you set it you can't
-- read it anymore." So the key is stored encrypted, and nothing reads it but the
-- Worker's own `/v1/ask` routes.
alter table users add column openai_key text;

-- The last four characters, in the clear on purpose. It is what the settings pane
-- shows - "set, ends in ...4f2a" - and keeping it here means a read never has to
-- decrypt anything and works even when the encryption secret is not set. Four
-- characters of a key identify which key it is to the person who made it and are
-- no use to anybody else.
alter table users add column openai_key_tail text;

-- Whatever plaintext key an older build already wrote. Dropped rather than
-- migrated: it cannot be encrypted here, and a key that is about to be
-- unreadable is better gone than left lying in a column. The pane says "not set"
-- and the reader pastes it once more.
update users
   set settings = json_remove(settings, '$.glassesKey')
 where json_valid(settings) and json_extract(settings, '$.glassesKey') is not null;

-- Something answered once and kept for a while. One table rather than one per
-- thing, the way `limits` is one table for every ceiling: a scope, a key, what was
-- answered and when it stops being worth answering with.
--
-- The model list is the first thing in it. It costs a request to OpenAI, it is the
-- same list all day, and the settings pane asks for it every time it is opened.
create table cached (
  scope text    not null,
  key   text    not null,
  value text    not null,
  until integer not null,
  primary key (scope, key)
);

create index cached_until on cached(until);
