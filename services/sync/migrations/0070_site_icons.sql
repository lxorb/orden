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
