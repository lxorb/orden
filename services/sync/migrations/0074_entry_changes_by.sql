-- The cursor of each device's latest change to a folder or a note, a delete aside, as a
-- JSON object from device to cursor (#1068). `updated_by` names only the last changer:
-- a device that deleted a note, restored it and deleted it again while away came back
-- with its own restore as the note's latest change, which hid another device's restore in
-- between from its second delete. A delete is refused for any device's change in here it
-- had not seen; a delete that stands empties it.
--
-- Only added: null is "nothing kept", which is every row today and answers as before, and
-- an app or a Worker that has never heard of it neither writes nor reads it.
alter table folders add column changes_by text;
alter table notes add column changes_by text;
