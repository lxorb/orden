-- What has been counted against a ceiling, and until when.
--
-- One table for every ceiling there is rather than a column wherever one is
-- wanted, because they are all the same shape: something is named, it happens,
-- and past a number inside a window it may not happen again yet. What is named
-- is the scope and the key together - the machine a sign-in code was asked
-- from, the machine a client registration came from, the space whose owner has
-- just been written to - so a new ceiling is a new scope and no new table.
--
-- A row past its window says nothing any more and is cleared as new ones
-- arrive, the way the sessions and the sign-in codes are. Nothing else would
-- ever take them away, and this is a table anybody who can reach the service
-- can cause a row in.
create table limits (
  scope text    not null,
  key   text    not null,
  count integer not null,
  -- When the window this row counts inside ends.
  until integer not null,
  primary key (scope, key)
);

-- Cleared by age rather than by name, so the sweep is one statement.
create index limits_until on limits(until);

-- Which addresses the service has written to today.
--
-- The ceiling above bounds how often one machine causes a send; this bounds how
-- many people the service writes to in a day, which is the number that says
-- whether it is being used as somebody else's mail gun. One row per address per
-- day, so the count is the row count - and an address already in today's set is
-- not one more person to write to, which is why a row is looked for before the
-- number is.
--
-- Yesterday's rows answer nothing and go as today's arrive.
create table mailed_days (
  day   integer not null,
  email text    not null,
  primary key (day, email)
);
