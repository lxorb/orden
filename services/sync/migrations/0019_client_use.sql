alter table oauth_clients add column used_at integer;

update oauth_clients set used_at = created_at;
