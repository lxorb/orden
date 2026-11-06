alter table machines add column host text not null default 'cloudflare'
  check (host in ('cloudflare', 'hetzner'));

alter table machines add column server_id integer;
alter table machines add column server_status text;
alter table machines add column spec text;
alter table machines add column price_month real;
alter table machines add column price_currency text;

alter table machines add column ssh_key text;

alter table machines add column disk_used integer not null default 0;
alter table machines add column disk_total integer not null default 0;
