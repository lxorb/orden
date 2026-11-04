-- Where somebody put a folder or a note among the others in its folder, by hand (#1068):
-- a fractional index (@orden/sync-core/order), kept on the entry, so it travels with it
-- through every rename and move and two people dragging rows of one folder each move only
-- what they dragged. Until now the order lived in `space_entries` as each folder's list of
-- child names, keyed by the folder's path, the last writer winning the whole folder.
--
-- Only added: null is "nobody put it anywhere", which is every row today, and an app or a
-- Worker that has never heard of it neither writes nor reads it.
alter table folders add column pos text;
alter table notes add column pos text;
