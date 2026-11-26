-- The activity log is append-only. Postgres itself refuses UPDATE and DELETE,
-- so not even a bug in the app can rewrite history. The single exception is
-- the student's own "Delete my data", which sets knowlix.erasing for that
-- transaction only (right to erasure beats retention).
CREATE OR REPLACE FUNCTION knowlix_activity_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('knowlix.erasing', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'activity_log is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER activity_log_append_only
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION knowlix_activity_append_only();
