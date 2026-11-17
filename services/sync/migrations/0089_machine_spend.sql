alter table machines add column price_hour real;
alter table machines add column priced_at integer;
alter table machines add column spent real not null default 0;
