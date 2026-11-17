create table user_addresses (
  email text primary key,
  user_id text not null,
  created_at integer not null
);

create index user_addresses_user on user_addresses (user_id);

create trigger user_addresses_free before insert on user_addresses
when exists (select 1 from users where email = new.email)
begin
  select raise(abort, 'address taken');
end;

create trigger users_address_free before insert on users
when exists (select 1 from user_addresses where email = new.email)
begin
  select raise(abort, 'address taken');
end;

create trigger users_address_moved before update of email on users
when exists (select 1 from user_addresses where email = new.email and user_id <> new.id)
begin
  select raise(abort, 'address taken');
end;
