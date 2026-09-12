-- What a reader typed into a form on a published page.
--
-- A form is a fence in a note (see services/sync/src/blog/form.ts), so an answer
-- belongs to the note that asked: the note's id rather than the page's address,
-- because an address can be a permalink, an alias or a path that has moved and
-- the note is the one name that does not.
--
-- `answers` is a JSON object keyed by the question as the note wrote it, so the
-- pane in the app and the CSV it exports read as the form rather than as
-- `field_3`. The whole row is bounded on the way in: twenty questions, four
-- thousand characters each.
--
-- What is deliberately not here: who sent it. No address, no user agent, no
-- fingerprint of any kind. A form on somebody's blog is a message, and the only
-- thing the account keeps of a stranger is the message. Spam is held off by the
-- rate limit every other route uses, keyed by a hash that lives as long as the
-- window and no longer; see services/sync/src/limits.ts.
create table form_answers (
  id text primary key,
  space_id text not null references spaces(id) on delete cascade,
  note_id text not null references notes(id) on delete cascade,
  at integer not null,
  answers text not null
);

-- What the pane reads: one note's answers, newest first.
create index form_answers_note on form_answers(note_id, at);

-- And what a space's own count reads, for the line in the publish sheet.
create index form_answers_space on form_answers(space_id, at);
