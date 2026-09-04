-- A space is reached at one address: a name on the shared domain, or a domain
-- of its own. Never both. The API has kept it that way; this makes the
-- database refuse the other case too, so no path that writes these columns
-- can end up with a space that answers on two hostnames.
--
-- SQLite cannot add a CHECK to a table that exists, so the guard is a pair
-- of triggers instead of a rebuild. Any row that holds both today keeps the
-- domain, which is the same rule the API applies when it is sent both: a
-- domain of one's own replaces the shared name.

update spaces
   set blog_subdomain = null
 where blog_subdomain is not null and blog_domain is not null;

create trigger if not exists spaces_one_address_insert
before insert on spaces
when new.blog_subdomain is not null and new.blog_domain is not null
begin
  select raise(abort, 'a space has one address, not two');
end;

create trigger if not exists spaces_one_address_update
before update of blog_subdomain, blog_domain on spaces
when new.blog_subdomain is not null and new.blog_domain is not null
begin
  select raise(abort, 'a space has one address, not two');
end;
