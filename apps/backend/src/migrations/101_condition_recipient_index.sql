-- A Condition evidence page reads the recipient deliveries of its own arrivals only; this index
-- finds them without scanning the Run's other deliveries. Additive: no row changes.
CREATE INDEX operation_intents_condition_arrival ON operation_intents(condition_arrival_id) WHERE condition_arrival_id IS NOT NULL
