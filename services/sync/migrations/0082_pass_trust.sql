alter table pass_keyrings add column sign_pub text;

alter table pass_vaults add column key_proof text;
alter table pass_vaults add column handovers text not null default '[]';

alter table pass_members add column vouch text;
alter table pass_members add column accepted text;
alter table pass_members add column pin text;
