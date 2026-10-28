ALTER TABLE orders ADD CONSTRAINT ck_order_status CHECK(status IN ('RECEIVED','DATA_HOLD','UNSUPPORTED','READY','TASK_CREATED'));
ALTER TABLE tasks ADD CONSTRAINT ck_task_status CHECK(status IN ('CREATED','ASSIGNED','IN_PROGRESS','HOLD','CONFIRMED'));
ALTER TABLE tasks ADD CONSTRAINT ck_task_owner CHECK(status='CREATED' OR (device_id IS NOT NULL AND assignment_version>0));
ALTER TABLE device_events ADD CONSTRAINT ck_event_outcome CHECK(outcome IN ('APPLIED','REJECTED'));
ALTER TABLE outbox_jobs ADD CONSTRAINT ck_outbox_status CHECK(status IN ('PENDING','DISPATCHED','DONE','FAILED') AND attempts>=0);
ALTER TABLE source_checkpoints ADD CONSTRAINT ck_checkpoint_status CHECK(status IN ('PAUSED','RUNNING','DONE','FAILED'));
