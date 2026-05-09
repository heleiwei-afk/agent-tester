import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// 任务表
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  agentName: text('agent_name'),           // 从平台API拉取的智能体名称
  botId: text('bot_id').notNull(),          // 平台上的 Bot/App ID
  platform: text('platform').notNull(),     // bailian / coze_cn / coze_global
  configJson: text('config_json').notNull(),// 完整配置 JSON
  status: text('status').notNull().default('pending'),
  // pending → generating → reviewing → running → done / cancelled / failed
  overallScore: integer('overall_score'),   // 综合评分 0-100
  totalCases: integer('total_cases'),       // 用例总数
  passedCases: integer('passed_cases'),     // 通过数
  failedCases: integer('failed_cases'),     // 失败数
  improvementReport: text('improvement_report'), // 改进报告 JSON
  reportContent: text('report_content'),         // 实时累积的 Markdown 报告内容
  errorMessage: text('error_message'),      // 任务级错误信息
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
});

// 测试用例表
export const cases = sqliteTable('cases', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  dimension: text('dimension').notNull(),
  // alignment / industry / boundary / badcase / security
  subType: text('sub_type').notNull(),
  turnsJson: text('turns_json').notNull(), // Array<{role, content}>
  expectation: text('expectation').notNull(),
  passCriteriaJson: text('pass_criteria_json').notNull(), // string[]
  weight: integer('weight').notNull().default(3),
  evaluationStrategy: text('evaluation_strategy').notNull().default('hybrid'),
  // rule / pattern / llm / hybrid
  checkpoints: text('checkpoints'),        // 多轮中间检查点 JSON
  evidenceHints: text('evidence_hints'),   // 提示 Judge 关注的关键点 JSON
  status: text('status').notNull().default('pending'),
  // pending / running / done / failed / timeout
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

// 执行结果表
export const results = sqliteTable('results', {
  id: text('id').primaryKey(),
  caseId: text('case_id').notNull().references(() => cases.id),
  taskId: text('task_id').notNull().references(() => tasks.id),
  rawResponseJson: text('raw_response_json'),
  responseContent: text('response_content'), // 智能体回复文本
  latencyMs: integer('latency_ms'),
  tokenCount: integer('token_count'),
  errorType: text('error_type'),           // timeout / api_error / rate_limit / null
  errorMsg: text('error_msg'),
  retryCount: integer('retry_count').default(0),
  createdAt: integer('created_at').notNull(),
});

// 判分表
export const verdicts = sqliteTable('verdicts', {
  id: text('id').primaryKey(),
  caseId: text('case_id').notNull().references(() => cases.id),
  taskId: text('task_id').notNull().references(() => tasks.id),
  pass: integer('pass').notNull(),          // 0 or 1
  score: integer('score').notNull(),        // 0-100
  reason: text('reason').notNull(),
  confidence: real('confidence').notNull(),
  severity: text('severity'),              // low / medium / high / critical
  suggestion: text('suggestion'),
  evidence: text('evidence'),              // 判定依据原文摘录
  strategyUsed: text('strategy_used'),     // rule / pattern / llm
  dualJudgeJson: text('dual_judge_json'),  // 双判详情 JSON
  hallucinationJson: text('hallucination_json'), // 幻觉检测结果 JSON
  perTurnScoresJson: text('per_turn_scores_json'), // 多轮每轮得分 JSON
  needsHumanReview: integer('needs_human_review').default(0),
  createdAt: integer('created_at').notNull(),
});
