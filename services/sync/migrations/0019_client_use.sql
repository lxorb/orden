-- When a registered client was last used to start a sign-in.
--
-- Registering is open to anybody, which is what RFC 7591 is for and what lets an
-- LLM client connect with nothing pasted anywhere. It also means the table grows
-- by a row for every client that ever asked, and most of those rows are a client
-- that connected once from a machine somebody has since reinstalled. A row
-- nothing is connected through and nothing has used is nothing, and without a
-- stamp there is no way to tell one of those from a client somebody signs in
-- with every day - so it was kept for ever. With this the nightly sweep can let
-- the dead ones go; see `expireClients` in src/oauth/clients.ts.
--
-- The rows already here are stamped with when they were made, which is the whole
-- of what is known about them.
alter table oauth_clients add column used_at integer;

update oauth_clients set used_at = created_at;
