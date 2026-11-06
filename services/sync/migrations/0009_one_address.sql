update spaces
   set blog_subdomain = null
 where blog_subdomain is not null and blog_domain is not null;

alter table spaces
  add column one_address integer
  check (blog_subdomain is null or blog_domain is null);
