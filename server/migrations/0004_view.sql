-- Polish 3: how the run was seen (metadata only, never used by the verifier). Existing rows were all full-arena runs.
ALTER TABLE entries ADD COLUMN view TEXT NOT NULL DEFAULT 'full';
ALTER TABLE entries ADD COLUMN p_view TEXT;
