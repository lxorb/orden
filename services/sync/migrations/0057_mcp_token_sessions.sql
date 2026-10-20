-- The session a connector token was handed out through (#461).
--
-- A token was a credential of its own, so ending the session that handed it out left
-- it working. It now names that session, by the hash the `sessions` row is keyed by,
-- and works only while that session is signed in; see src/mcp/tokens.ts.
--
-- A row from before names none and keeps working until the connector is handed a
-- token again, which replaces it. An older Worker never reads the column.
alter table mcp_tokens add column session_hash text;
