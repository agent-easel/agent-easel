-- The worker turn a Final result was reported from, when Factory observed the worker thread at
-- acceptance. Existing results have none: their later never-started cancellations stay failures.
ALTER TABLE runtime_reports ADD COLUMN reporting_execution_id TEXT
