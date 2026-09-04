-- The icon belongs to the space, not to the machine that chose it. It lived in
-- local storage keyed by the folder path, so a second device had nothing to
-- show and could not have matched the key anyway.
alter table spaces add column icon text;
