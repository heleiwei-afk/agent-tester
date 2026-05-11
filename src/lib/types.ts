import { z } from 'zod';

// 平台枚举
export const PlatformEnum = z.enum(['bailian', 'coze_cn', 'coze_global']);
export type Platform = z.infer<typeof PlatformEnum>;

// 行业枚举
export const IndustryEnum = z.enum(['education', 'finance', 'medical', 'customer_service', 'general']);
export type Industry = z.infer<typeof IndustryEnum>;

// 测试维度
export const DimensionEnum = z.enum(['alignment', 'industry', 'boundary', 'badcase', 'security']);
export type Dimension = z.infer<typeof DimensionEnum>;

// 任务状态
export const TaskStatusEnum = z.enum(['pending', 'analyzing', 'outline_review', 'generating', 'reviewing', 'running', 'completing', 'done', 'cancelled', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

// 用例状态
export const CaseStatusEnum = z.enum(['pending', 'running', 'done', 'failed', 'timeout']);
export type CaseStatus = z.infer<typeof CaseStatusEnum>;

// 严重度
export const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeverityEnum>;

// 评估策略
export const EvaluationStrategyEnum = z.enum(['rule', 'pattern', 'llm', 'hybrid']);
export type EvaluationStrategy = z.infer<typeof EvaluationStrategyEnum>;

// 错误类型
export const ErrorTypeEnum = z.enum(['auth_failed', 'not_found', 'rate_limit', 'timeout', 'server_error', 'content_filtered', 'unknown']);
export type ErrorType = z.infer<typeof ErrorTypeEnum>;

// 任务配置 Schema
export const TaskConfigSchema = z.object({
  platform: PlatformEnum,
  apiKey: z.string().min(1, '请输入 API Key'),
  botId: z.string().min(1, '请输入 Bot/App ID'),
  agentName: z.string().optional(), // 用户手动填写的智能体名称（可选）
  expectedBehavior: z.string().min(20, '预期行为描述至少 20 字'),
  industry: IndustryEnum.default('general'),
  caseCount: z.number().int().min(10).max(200).default(50),
  multiTurnRatio: z.number().min(0).max(1).default(0.2),
  timeoutSec: z.number().int().min(5).max(120).default(30),
  retryCount: z.number().int().min(0).max(5).default(2),
  testContext: z.string().optional(), // 测试素材 JSON（每次新会话首轮传入）
  systemPrompt: z.string().optional(), // 用户手动粘贴的 system prompt（可选）
});
export type TaskConfig = z.infer<typeof TaskConfigSchema>;

// 对话消息
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// 测试用例
export interface TestCase {
  id: string;
  taskId: string;
  dimension: Dimension;
  subType: string;
  turns: ChatMessage[];
  expectation: string;
  passCriteria: string[];
  weight: number;
  evaluationStrategy: EvaluationStrategy;
  checkpoints?: string[];
  evidenceHints?: string[];
  status: CaseStatus;
  newSession: boolean;  // true = 此用例开始新会话
  orderIndex: number;
  goalId?: string;      // 大纲追溯：测试目标 ID
  scenarioId?: string;  // 大纲追溯：测试场景 ID
  pointId?: string;     // 大纲追溯：测试点 ID
}

// 适配器响应
export interface AdapterResponse {
  content: string;
  raw: unknown;
  latencyMs: number;
  tokenUsage?: { input: number; output: number };
  debugUrl?: string;
}

// 判分结果
export interface Verdict {
  caseId: string;
  pass: boolean;
  score: number;
  reason: string;
  confidence: number;
  severity?: Severity;
  suggestion?: string;
  evidence: string;
  strategyUsed: 'rule' | 'pattern' | 'llm';
  dualJudge: {
    judge1: { pass: boolean; score: number; reason: string };
    judge2: { pass: boolean; score: number; reason: string };
    consensus: boolean;
  };
  hallucinationCheck?: {
    detected: boolean;
    details?: string;
  };
  perTurnScores?: number[];
  needsHumanReview: boolean;
}

// 改进报告结构
export interface ImprovementReport {
  summary: {
    overallAssessment: string;
    keyIssues: Array<{ issue: string; severity: Severity; count: number }>;
    priorityOrder: string[];
  };
  details: Array<{
    issue: string;
    severity: Severity;
    dimension: Dimension;
    affectedCases: string[];
    originalConversation: { input: string; output: string };
    analysis: string;
    suggestions: {
      promptModification?: string;
      knowledgeBaseAddition?: string;
      workflowAdjustment?: string;
    };
    expectedImprovement: string;
  }>;
}

// 用例自审结果
export interface SelfReviewResult {
  caseIndex: number;
  discrimination: number;  // 区分度 0-10
  realism: number;         // 真实性 0-10
  verifiability: number;   // 可验证性 0-10
  overallQuality: number;  // 综合质量 0-10
  reason: string;
  shouldRegenerate: boolean;
}

// ============ 测试大纲相关类型 ============

export interface TestOutline {
  agentAnalysis: AgentAnalysis;
  testGoals: TestGoal[];
}

export interface AgentAnalysis {
  coreValue: string;           // 智能体的核心价值
  targetUsers: string[];       // 目标用户群体
  keyCapabilities: string[];   // 关键能力
  riskAreas: string[];         // 高风险区域
}

export interface TestGoal {
  id: string;
  name: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  rationale: string;           // 为什么要测这个
  scenarios: TestScenario[];
}

export interface TestScenario {
  id: string;
  name: string;
  userContext: string;         // 用户在什么情况下会遇到
  expectedOutcome: string;     // 期望智能体如何表现
  testPoints: TestPoint[];
}

export interface TestPoint {
  id: string;
  description: string;
  testType: 'positive' | 'negative' | 'boundary' | 'stress';
  estimatedCaseCount: number;
  passCriteria: string[];
}
