-- Proving that a domain of one's own is one's own.
--
-- Until now `blog_domain` was the whole of the claim, so the first person to type
-- a name held it: the real owner of notes.example.com was answered "that domain
-- is taken" for ever, and Nib asked Cloudflare for a certificate for a name
-- belonging to somebody else. A row is not a claim to a name in DNS.
--
-- So a claim now waits on a record only whoever holds the domain can write:
-- `_nib-verify.<domain>` holding the token below, read over DNS over HTTPS. Until
-- that is there the domain is recorded, serves nothing, and stands in nobody's
-- way - a second claim on an unproved domain takes it. See src/spaces/proof.ts.
alter table spaces add column blog_domain_token text;

-- When the record was last seen. Null while a domain is claimed and unproved,
-- which is also what says it may not serve; stamped again by every re-check that
-- finds the record, so it doubles as how old the proof is. A domain changes
-- hands, and a proof nobody has looked at for weeks is not a proof.
alter table spaces add column blog_domain_verified_at integer;
