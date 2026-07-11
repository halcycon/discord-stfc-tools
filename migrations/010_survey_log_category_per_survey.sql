-- Per-survey log category override (falls back to guild survey_log_category_id).

ALTER TABLE surveys ADD COLUMN log_category_id TEXT;
