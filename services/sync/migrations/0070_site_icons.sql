-- The marks of the sites an account has been to, for the icon picker's Web icons
-- (#1054): one row per site, the picture held here so every device draws the same one
-- without asking the site. `source` is where the picture was fetched from, so a page
-- naming the same mark again is not fetched again; `hash` is the picture's, so a
-- device can tell whether the one it holds is still current. See src/site-icons.ts.
create table site_icons (
  user_id text    not null references users(id) on delete cascade,
  site    text    not null,
  label   text    not null default '',
  seen    integer not null,
  source  text,
  hash    text,
  type    text,
  picture blob,
  primary key (user_id, site)
);

create index site_icons_seen on site_icons (user_id, seen desc);
