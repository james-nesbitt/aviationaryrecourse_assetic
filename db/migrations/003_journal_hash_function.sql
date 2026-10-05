-- Postgres function to compute the hash chain row_hash over the stored representation.
-- This ensures insert and verification use the same canonicalization.
-- The hash is computed over: chain_key || '|' || journal_id || '|' || COALESCE(prev_hash,'GENESIS')
--   || '|' || event_type || '|' || entity_id || '|' || payload::text || '|' || valid_time::text
-- Using pgcrypto's digest() for SHA-256.

CREATE OR REPLACE FUNCTION assetic_journal_row_hash(
  p_chain_key      TEXT,
  p_journal_id     BIGINT,
  p_prev_hash      TEXT,
  p_event_type     TEXT,
  p_entity_id      TEXT,
  p_payload        JSONB,
  p_valid_time     TIMESTAMPTZ
) RETURNS TEXT AS $$
  SELECT encode(
    digest(
      p_chain_key || '|' ||
      p_journal_id::text || '|' ||
      COALESCE(p_prev_hash, 'GENESIS') || '|' ||
      p_event_type || '|' ||
      p_entity_id || '|' ||
      p_payload::text || '|' ||
      p_valid_time::text,
      'sha256'
    ),
    'hex'
  );
$$ LANGUAGE sql IMMUTABLE;