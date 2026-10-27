CREATE TABLE dataset_runs (
 id CHAR(36) PRIMARY KEY, dataset_version VARCHAR(128) NOT NULL, manifest JSON NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'REGISTERED', created_at VARCHAR(30) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE source_checkpoints (
 run_id CHAR(36) NOT NULL, source VARCHAR(32) NOT NULL, cursor_token TEXT NULL,
 status VARCHAR(20) NOT NULL, updated_at VARCHAR(30) NOT NULL,
 PRIMARY KEY(run_id, source), FOREIGN KEY(run_id) REFERENCES dataset_runs(id)
) ENGINE=InnoDB;
CREATE TABLE products (
 run_id CHAR(36) NOT NULL, product_id CHAR(32) NOT NULL, category VARCHAR(255) NULL,
 attributes JSON NOT NULL, PRIMARY KEY(run_id,product_id), FOREIGN KEY(run_id) REFERENCES dataset_runs(id)
) ENGINE=InnoDB;
CREATE TABLE sellers (
 run_id CHAR(36) NOT NULL, seller_id VARCHAR(128) NOT NULL,
 PRIMARY KEY(run_id,seller_id), FOREIGN KEY(run_id) REFERENCES dataset_runs(id)
) ENGINE=InnoDB;
CREATE TABLE raw_orders (
 id CHAR(36) PRIMARY KEY, run_id CHAR(36) NOT NULL, source VARCHAR(32) NOT NULL,
 source_record_id VARCHAR(180) NOT NULL, external_order_id VARCHAR(128) NULL,
 payload JSON NOT NULL, payload_hash CHAR(64) NOT NULL,
 UNIQUE(run_id,source,source_record_id), UNIQUE(run_id,source,external_order_id),
 FOREIGN KEY(run_id) REFERENCES dataset_runs(id)
) ENGINE=InnoDB;
CREATE TABLE source_conflicts (
 id CHAR(36) PRIMARY KEY, raw_order_id CHAR(36) NOT NULL, payload_hash CHAR(64) NOT NULL,
 payload JSON NOT NULL, observed_at VARCHAR(30) NOT NULL,
 UNIQUE(raw_order_id,payload_hash), FOREIGN KEY(raw_order_id) REFERENCES raw_orders(id)
) ENGINE=InnoDB;
CREATE TABLE orders (
 id CHAR(36) PRIMARY KEY, raw_order_id CHAR(36) NOT NULL UNIQUE, run_id CHAR(36) NOT NULL,
 revision INT NOT NULL DEFAULT 1, source_order_id VARCHAR(180) NOT NULL,
 source_status VARCHAR(40) NOT NULL, status VARCHAR(24) NOT NULL,
 seller_id VARCHAR(128) NULL, hold_reasons JSON NOT NULL, quality_flags JSON NOT NULL,
 CHECK(revision>=1), FOREIGN KEY(raw_order_id) REFERENCES raw_orders(id),
 INDEX(run_id,status,id)
) ENGINE=InnoDB;
CREATE TABLE order_items (
 order_id CHAR(36) NOT NULL, product_id CHAR(32) NOT NULL, required_qty INT NOT NULL,
 PRIMARY KEY(order_id,product_id), CHECK(required_qty>0), FOREIGN KEY(order_id) REFERENCES orders(id)
) ENGINE=InnoDB;
CREATE TABLE devices (
 id VARCHAR(128) PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE, enabled BOOLEAN NOT NULL,
 last_seen_at VARCHAR(30) NULL, last_report JSON NULL, report_received_at VARCHAR(30) NULL
) ENGINE=InnoDB;
CREATE TABLE tasks (
 id CHAR(36) PRIMARY KEY, run_id CHAR(36) NOT NULL, order_id CHAR(36) NOT NULL UNIQUE,
 status VARCHAR(24) NOT NULL, device_id VARCHAR(128) NULL,
 assignment_version INT NOT NULL DEFAULT 0, last_processed_seq INT NOT NULL DEFAULT 0,
 snapshot JSON NULL, confirmed_at VARCHAR(30) NULL, business_date CHAR(10) NULL,
 local_completed_at VARCHAR(30) NULL, hold_reason VARCHAR(128) NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(device_id) REFERENCES devices(id),
 INDEX(run_id,status,id), INDEX(device_id,run_id,id), INDEX(run_id,business_date,status),
 CHECK(assignment_version>=0 AND last_processed_seq>=0)
) ENGINE=InnoDB;
CREATE TABLE task_items (
 task_id CHAR(36) NOT NULL, product_id CHAR(32) NOT NULL, required_qty INT NOT NULL,
 applied_qty INT NOT NULL DEFAULT 0, PRIMARY KEY(task_id,product_id),
 CHECK(required_qty>0 AND applied_qty>=0 AND applied_qty<=required_qty),
 FOREIGN KEY(task_id) REFERENCES tasks(id)
) ENGINE=InnoDB;
CREATE TABLE device_events (
 device_id VARCHAR(128) NOT NULL, event_id CHAR(36) NOT NULL, task_id CHAR(36) NOT NULL,
 assignment_version INT NOT NULL, seq INT NOT NULL, canonical_hash CHAR(64) NOT NULL,
 event_body JSON NOT NULL, outcome VARCHAR(20) NOT NULL, result JSON NOT NULL,
 PRIMARY KEY(device_id,event_id), UNIQUE(task_id,assignment_version,seq),
 CHECK(seq>0 AND assignment_version>0), FOREIGN KEY(task_id) REFERENCES tasks(id)
) ENGINE=InnoDB;
CREATE TABLE task_scans (
 event_id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, product_id CHAR(32) NOT NULL,
 reversed_by_event_id CHAR(36) NULL UNIQUE, FOREIGN KEY(task_id) REFERENCES tasks(id)
) ENGINE=InnoDB;
CREATE TABLE outbox_jobs (
 id CHAR(36) PRIMARY KEY, run_id CHAR(36) NOT NULL, type VARCHAR(32) NOT NULL,
 aggregate_id VARCHAR(128) NOT NULL, dedupe_key VARCHAR(255) NOT NULL UNIQUE,
 payload JSON NOT NULL, status VARCHAR(20) NOT NULL, available_at VARCHAR(30) NOT NULL,
 lease_until VARCHAR(30) NULL, attempts INT NOT NULL DEFAULT 0, error_code VARCHAR(128) NULL,
 INDEX(status,available_at,lease_until), INDEX(run_id,status,id), FOREIGN KEY(run_id) REFERENCES dataset_runs(id)
) ENGINE=InnoDB;
CREATE TABLE job_attempts (
 id CHAR(36) PRIMARY KEY, job_id CHAR(36) NOT NULL, attempt INT NOT NULL,
 started_at VARCHAR(30) NOT NULL, ended_at VARCHAR(30) NOT NULL, error_code VARCHAR(128) NULL,
 FOREIGN KEY(job_id) REFERENCES outbox_jobs(id)
) ENGINE=InnoDB;
CREATE TABLE report_daily (
 run_id CHAR(36) NOT NULL, business_date CHAR(10) NOT NULL, task_count INT NOT NULL,
 item_count INT NOT NULL, computed_at VARCHAR(30) NOT NULL, PRIMARY KEY(run_id,business_date)
) ENGINE=InnoDB;
CREATE TABLE report_daily_product (
 run_id CHAR(36) NOT NULL, business_date CHAR(10) NOT NULL, product_id CHAR(32) NOT NULL,
 quantity INT NOT NULL, computed_at VARCHAR(30) NOT NULL, PRIMARY KEY(run_id,business_date,product_id)
) ENGINE=InnoDB;
CREATE TABLE audit_logs (
 id CHAR(36) PRIMARY KEY, actor_type VARCHAR(20) NOT NULL, actor_id VARCHAR(128) NOT NULL,
 action VARCHAR(64) NOT NULL, target_id VARCHAR(128) NOT NULL,
 reason TEXT NOT NULL, before_after JSON NOT NULL, at VARCHAR(30) NOT NULL, INDEX(target_id,at)
) ENGINE=InnoDB;
CREATE TABLE admin_requests (
 actor_id VARCHAR(128) NOT NULL, request_id CHAR(36) NOT NULL, target_id VARCHAR(180) NOT NULL,
 canonical_hash CHAR(64) NOT NULL, stored_response JSON NOT NULL, created_at VARCHAR(30) NOT NULL,
 PRIMARY KEY(actor_id,request_id)
) ENGINE=InnoDB;
