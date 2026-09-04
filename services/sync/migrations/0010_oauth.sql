-- OAuth for the connector, so an LLM client signs the person in itself instead
-- of being handed a token to paste.

-- Clients that registered themselves (RFC 7591). A client whose id is a URL
-- describes itself at that URL and has no row here. Only the hash of a secret
-- is kept, and most clients have none: they prove themselves with PKCE.
create table oauth_clients (
  id            text    primary key,
  name          text    not null,
  -- A JSON array. Exact matches only, except that a loopback address may
  -- answer on whatever port was free.
  redirect_uris text    not null,
  secret_hash   text,
  created_at    integer not null
);

-- A code handed to the browser after consent, good once and briefly. What it
-- was granted travels with it into the token it becomes.
create table oauth_codes (
  code_hash    text    primary key,
  client_id    text    not null,
  user_id      text    not null references users(id) on delete cascade,
  redirect_uri text    not null,
  challenge    text    not null,
  read_only    integer not null default 1,
  expires_at   integer not null
);

-- One connection between a client and an account: the access token it holds
-- now and the refresh token that replaces it. The refresh token before the
-- current one still counts, so a reply lost on the way does not lock the
-- client out. Both live hashed, like every other secret here.
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
