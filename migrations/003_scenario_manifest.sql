CREATE TABLE dataset_scenarios (
 run_id CHAR(36) PRIMARY KEY, scenario_hash CHAR(64) NOT NULL, scenario JSON NOT NULL,
 FOREIGN KEY(run_id) REFERENCES dataset_runs(id)
) ENGINE=InnoDB;
