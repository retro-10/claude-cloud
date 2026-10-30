-- Typo-tolerant search in the command palette (word_similarity). Supabase ships pg_trgm; on Supabase it lands in the
-- extensions schema, which is on the default search path.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
