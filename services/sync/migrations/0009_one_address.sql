-- A space is reached at one address: a name on the shared domain, or a domain
-- of its own. Never both. The API has kept it that way; this makes the
-- database refuse the other case too, so no path that writes these columns
-- can end up with a space that answers on two hostnames.
--
-- SQLite cannot add a CHECK to a table that exists, and D1 cannot create a
-- trigger: its API splits a script at every semicolon, including the ones
-- inside a trigger body, and then rejects the pieces as incomplete. So the
-- guard is a CHECK on a column added for the purpose. The column stays null;
-- only its constraint matters. Any row that holds both today keeps the
-- domain, which is the same rule the API applies when it is sent both: a
-- domain of one's own replaces the shared name.

update spaces
   set blog_subdomain = null
 where blog_subdomain is not null and blog_domain is not null;

alter table spaces
  add column one_address integer
  check (blog_subdomain is null or blog_domain is null);
