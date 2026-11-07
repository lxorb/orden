create table pass_seq (
  id integer primary key check (id = 1),
  seq integer not null
);

insert into pass_seq (id, seq) values (1, 0);

create table pass_keyrings (
  user_id text primary key,
  rev integer not null,
  keyring text not null,
  pub text not null,
  updated_at integer not null,
  seq integer not null
);

create table pass_vaults (
  id text primary key,
  owner_id text not null,
  rev integer not null,
  meta text not null,
  key_version integer not null,
  deleted_at integer,
  seq integer not null
);

create index pass_vaults_owner on pass_vaults (owner_id, deleted_at);

create table pass_members (
  vault_id text not null,
  email text not null,
  user_id text,
  role text not null check (role in ('viewer', 'editor', 'manager', 'owner')),
  state text not null check (state in ('pending', 'confirm', 'active', 'removed')),
  key text,
  key_version integer not null,
  invited_by text,
  seq integer not null,
  primary key (vault_id, email)
);

create index pass_members_email on pass_members (email, state);
create index pass_members_user on pass_members (user_id);
create index pass_members_invited_by on pass_members (invited_by);

create table pass_items (
  vault_id text not null,
  id text not null,
  rev integer not null,
  key text not null,
  body text not null,
  key_version integer not null,
  at integer not null,
  deleted_at integer,
  seq integer not null,
  primary key (vault_id, id)
);

create index pass_items_seq on pass_items (vault_id, seq);

create table pass_versions (
  vault_id text not null,
  id text not null,
  rev integer not null,
  key text not null,
  body text not null,
  key_version integer not null,
  at integer not null,
  primary key (vault_id, id, rev)
);

create table pass_links (
  id text primary key,
  user_id text not null,
  vault_id text not null,
  item_id text not null,
  body text not null,
  expires_at integer not null,
  max_views integer,
  views integer not null default 0,
  created_at integer not null
);

create index pass_links_user on pass_links (user_id, created_at);
create index pass_links_item on pass_links (vault_id, item_id);
create index pass_links_expires on pass_links (expires_at);
