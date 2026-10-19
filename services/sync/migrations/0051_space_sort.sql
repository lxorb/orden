-- Which order a space's file list is read in: by name either way round, by when its
-- notes were changed or made either way round, or the order somebody arranged by hand
-- (#423). Emil: "if I turn on manual for one space, it will remain on for that space
-- even on other devices". The hand-arranged order itself is `arranged`; this is which
-- of the seven the list is read in.
--
-- On the space, beside `arranged`, so every device signed in reads the space in the same
-- order, and keyed by the space rather than by a folder on one machine. Empty until
-- somebody chooses, which is the name order every list starts in.
alter table spaces add column sort text not null default '';
