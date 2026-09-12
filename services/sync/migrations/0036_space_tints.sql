-- The colour an icon is drawn in, beside the icon it colours: one column for the
-- space's own mark, one map for the folders of its tree.
--
-- Two columns rather than one, because there are two icons and each already has a
-- column of its own - `icon` from 0006 and `icons` from 0023. A tint is the second
-- half of a choice somebody made in one gesture, so it is kept beside the first
-- half rather than in a table that would have to be joined to say what a mark looks
-- like.
--
-- Not folded into the icon's own value. The app writes a note's icon as `icon:` and
-- its colour as `icon-color:` on the next line, so that Obsidian's Iconize still
-- finds the icon and ignores the colour; a value carrying both would be a word no
-- other app knows. The same two values, in the same two places, for the two icons
-- that have no file to keep them in.
--
-- A colour is one of the app's own accents by its id - `violet`, `teal` - so what
-- travels is a name the theme resolves, with a shade for black and one for white,
-- and not a hex somebody's machine picked out of its own palette.
alter table spaces add column tint text;
alter table spaces add column tints text not null default '{}';
