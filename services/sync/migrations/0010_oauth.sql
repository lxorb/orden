create table oauth_clients (
  id            text    primary key,
  name          text    not null,
  redirect_uris text    not null,
  secret_hash   text,
  created_at    integer not null
);

create table oauth_codes (
  code_hash    text    primary key,
  client_id    text    not null,
  user_id      text    not null references users(id) on delete cascade,
  redirect_uri text    not null,
  challenge    text    not null,
  read_only    integer not null default 1,
  expires_at   integer not null
);

create table oauth_grants (
  id                    text    primary key,
  user_id               text    not null references users(id) on delete cascade,
  client_id             text    not null,
  client_name           text    not null,
  read_only             integer not null default 1,
  access_hash           text    not null unique,
  access_expires_at     integer not null,
  refresh_hash          text    not null unique,
  previous_refresh_hash text,
  created_at            integer not null,
  last_used_at          integer
);

create index oauth_grants_user on oauth_grants(user_id);
create index oauth_grants_previous on oauth_grants(previous_refresh_hash);
