import { getDB } from './index';

/**
 * 初始化数据库表结构
 * 在应用启动时调用
 */
export function initDatabase() {
  const db = getDB();
  const sqlite = (db as any).session?.client;
  if (!sqlite) return;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      agent_name TEXT,
      bot_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      config_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      overall_score INTEGER,
      total_cases INTEGER,
      passed_cases INTEGER,
      failed_cases INTEGER,
      improvement_report TEXT,
      report_content TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      dimension TEXT NOT NULL,
      sub_type TEXT NOT NULL,
      turns_json TEXT NOT NULL,
      expectation TEXT NOT NULL,
      pass_criteria_json TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 3,
      evaluation_strategy TEXT NOT NULL DEFAULT 'hybrid',
      checkpoints TEXT,
      evidence_hints TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      task_id TEXT NOT NULL REFERENCES tasks(id),
      raw_response_json TEXT,
      response_content TEXT,
      latency_ms INTEGER,
      token_count INTEGER,
      error_type TEXT,
      error_msg TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verdicts (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id),
      task_id TEXT NOT NULL REFERENCES tasks(id),
      pass INTEGER NOT NULL,
      score INTEGER NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      severity TEXT,
      suggestion TEXT,
      evidence TEXT,
      strategy_used TEXT,
      dual_judge_json TEXT,
      hallucination_json TEXT,
      per_turn_scores_json TEXT,
      needs_human_review INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cases_task_id ON cases(task_id);
    CREATE INDEX IF NOT EXISTS idx_results_case_id ON results(case_id);
    CREATE INDEX IF NOT EXISTS idx_results_task_id ON results(task_id);
    CREATE INDEX IF NOT EXISTS idx_verdicts_case_id ON verdicts(case_id);
    CREATE INDEX IF NOT EXISTS idx_verdicts_task_id ON verdicts(task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_bot_id ON tasks(bot_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);
}
