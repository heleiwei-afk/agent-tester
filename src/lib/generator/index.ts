import { v4 as uuid } from 'uuid';
import { callLLMForJSON } from '../llm';
import {
  CAPABILITY_EXTRACTION_PROMPT,
  USER_PROFILE_PROMPT,
  ALIGNMENT_PROMPT,
  BOUNDARY_PROMPT,
  INDUSTRY_PROMPT,
  BADCASE_PROMPT,
  SECURITY_PROMPT,
  SELF_REVIEW_PROMPT,
} from './prompts';
import { getIndustryRules } from './industry-rules';
import type { TaskConfig, TestCase, Dimension, SelfReviewResult } from '../types';
import { createTaskLogger } from '../logger';

const logger = createTaskLogger('generator');

interface GeneratedCase {
  subType: string;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectation: string;
  passCriteria: string[];
  weight: number;
  evaluationStrategy: string;
}

interface CapabilityResult {
  capabilities: Array<{
    name: string;
    description: string;
    importance: string;
    interactionType: string;
    examples: string[];
  }>;
  boundaries: Array<{ description: string; reason: string }>;
  targetScenarios: string[];
}

interface UserProfileResult {
  demographics: {
    ageRange: string;
    techLevel: string;
    educationLevel: string;
    expressionStyle: string;
  };
  behaviorPatterns: {
    typicalQuestions: string[];
    nonStandardExpressions: string[];
    multiTurnBehaviors: string[];
    frustrationTriggers: string[];
  };
  expectations: {
    responseStyle: string;
    responseSpeed: string;
    errorTolerance: string;
  };
}

/**
 * 用例生成引擎主入口
 * 
 * 流程：能力提取 → 用户画像推断 → 分维度生成 → 自审过滤
 */
export async function generateTestCases(
  taskId: string,
  config: TaskConfig,
  dimensions: Dimension[] = ['alignment', 'boundary']
): Promise<TestCase[]> {
  logger.info({ taskId, dimensions }, '开始生成测试用例');

  // 第一步：提取核心能力
  const capabilities = await extractCapabilities(config);
  logger.info({ taskId, capCount: capabilities.capabilities.length }, '能力提取完成');

  // 第二步：推断用户画像
  const userProfile = await inferUserProfile(config);
  logger.info({ taskId }, '用户画像推断完成');

  // 第三步：按维度生成用例
  const allCases: TestCase[] = [];
  const caseCountPerDimension = distributeCaseCount(config.caseCount, dimensions);

  for (const dimension of dimensions) {
    const count = caseCountPerDimension[dimension] || 0;
    if (count === 0) continue;

    const cases = await generateByDimension(
      taskId, config, dimension, count, capabilities, userProfile
    );
    allCases.push(...cases);
    logger.info({ taskId, dimension, generated: cases.length }, '维度用例生成完成');
  }

  // 第四步：去重
  const deduplicated = deduplicateCases(allCases);
  logger.info({ taskId, before: allCases.length, after: deduplicated.length }, '去重完成');

  // 第五步：自审
  const reviewed = await selfReviewCases(taskId, deduplicated);
  logger.info({ taskId, final: reviewed.length }, '自审完成，用例生成结束');

  return reviewed;
}

/**
 * 提取核心能力清单（带重试+降级）
 */
async function extractCapabilities(config: TaskConfig): Promise<CapabilityResult> {
  const MAX_RETRIES = 2;
  for (let retry = 0; retry <= MAX_RETRIES; retry++) {
    try {
      return await callLLMForJSON<CapabilityResult>({
        systemPrompt: CAPABILITY_EXTRACTION_PROMPT,
        userPrompt: `【智能体功能描述】\n${config.expectedBehavior}\n\n【所属行业】${config.industry}`,
        temperature: 0.3,
        model: process.env.LLM_GENERATION_MODEL || 'claude-sonnet-4-6',
      });
    } catch (error) {
      logger.warn({ retry, error: (error as Error).message }, '能力提取失败');
      if (retry < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  // 最终降级：基于 expectedBehavior 构造简单能力列表
  logger.warn('能力提取全部失败，使用降级方案');
  return {
    capabilities: [{
      name: '核心功能',
      description: config.expectedBehavior,
      importance: '核心',
      interactionType: '问答',
      examples: ['用户正常使用场景'],
    }],
    boundaries: [{ description: '超出描述范围的请求', reason: '非核心功能' }],
    targetScenarios: ['日常使用'],
  };
}

/**
 * 推断目标用户画像（带重试+降级）
 */
async function inferUserProfile(config: TaskConfig): Promise<UserProfileResult> {
  const MAX_RETRIES = 2;
  for (let retry = 0; retry <= MAX_RETRIES; retry++) {
    try {
      return await callLLMForJSON<UserProfileResult>({
        systemPrompt: USER_PROFILE_PROMPT,
        userPrompt: `【智能体功能描述】\n${config.expectedBehavior}\n\n【所属行业】${config.industry}`,
        temperature: 0.5,
        model: process.env.LLM_GENERATION_MODEL || 'claude-sonnet-4-6',
      });
    } catch (error) {
      logger.warn({ retry, error: (error as Error).message }, '用户画像推断失败');
      if (retry < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  // 最终降级：返回通用用户画像
  logger.warn('用户画像推断全部失败，使用通用画像');
  return {
    demographics: {
      ageRange: '18-45',
      techLevel: '中',
      educationLevel: '大学',
      expressionStyle: '口语化',
    },
    behaviorPatterns: {
      typicalQuestions: ['直接提问'],
      nonStandardExpressions: ['口语化表达'],
      multiTurnBehaviors: ['追问', '纠错'],
      frustrationTriggers: ['答非所问', '重复回答'],
    },
    expectations: {
      responseStyle: '简洁明了',
      responseSpeed: '快速',
      errorTolerance: '中等',
    },
  };
}

/**
 * 按维度分配用例数量
 */
function distributeCaseCount(
  total: number,
  dimensions: Dimension[]
): Record<string, number> {
  const ratios: Record<Dimension, number> = {
    alignment: 0.4,
    industry: 0.2,
    boundary: 0.15,
    badcase: 0.15,
    security: 0.1,
  };

  // 只计算启用的维度
  const activeRatios = dimensions.reduce((acc, d) => {
    acc[d] = ratios[d];
    return acc;
  }, {} as Record<string, number>);

  // 归一化
  const sum = Object.values(activeRatios).reduce((a, b) => a + b, 0);
  const result: Record<string, number> = {};
  let allocated = 0;

  dimensions.forEach((d, i) => {
    if (i === dimensions.length - 1) {
      result[d] = total - allocated;
    } else {
      const count = Math.round((activeRatios[d] / sum) * total);
      result[d] = count;
      allocated += count;
    }
  });

  return result;
}

/**
 * 按维度生成用例
 */
async function generateByDimension(
  taskId: string,
  config: TaskConfig,
  dimension: Dimension,
  count: number,
  capabilities: CapabilityResult,
  userProfile: UserProfileResult
): Promise<TestCase[]> {
  const promptTemplate = getPromptForDimension(dimension);
  const variables = {
    expectedBehavior: config.expectedBehavior,
    industry: config.industry,
    capabilities: JSON.stringify(capabilities.capabilities, null, 2),
    boundaries: JSON.stringify(capabilities.boundaries, null, 2),
    userProfile: JSON.stringify(userProfile, null, 2),
    multiTurnRatio: String(config.multiTurnRatio),
    industryRules: dimension === 'industry'
      ? getIndustryRules(config.industry)
      : '',
  };

  // 替换模板变量
  let prompt = promptTemplate;
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  // 分批生成：每批最多 10 条，避免 JSON 过长被截断
  const BATCH_SIZE = 10;
  const MAX_BATCH_RETRIES = 2;
  const allCases: TestCase[] = [];
  let remaining = count;
  let batchIndex = 0;

  while (remaining > 0) {
    const batchCount = Math.min(remaining, BATCH_SIZE);
    batchIndex++;
    const userPrompt = `请生成 ${batchCount} 条测试用例。\n\n${prompt}`;
    let success = false;

    for (let retry = 0; retry <= MAX_BATCH_RETRIES; retry++) {
      logger.info({ taskId, dimension, batchIndex, batchCount, retry }, '正在生成用例批次');

      try {
        const result = await callLLMForJSON<{ cases: GeneratedCase[] }>({
          systemPrompt: '你是专业的智能体测试用例生成器。严格按照要求的 JSON 格式输出。确保输出完整的 JSON，不要截断。',
          userPrompt,
          temperature: 0.8,
          maxTokens: 16384,
          model: process.env.LLM_GENERATION_MODEL || 'claude-sonnet-4-6',
        });

        const cases = (result.cases || []).map((c, index) => ({
          id: uuid(),
          taskId,
          dimension,
          subType: c.subType || 'unknown',
          turns: c.turns || [],
          expectation: c.expectation || '',
          passCriteria: c.passCriteria || [],
          weight: Math.min(5, Math.max(1, c.weight || 3)),
          evaluationStrategy: (c.evaluationStrategy as any) || 'hybrid',
          status: 'pending' as const,
          orderIndex: allCases.length + index,
        }));

        allCases.push(...cases);
        remaining -= cases.length;
        success = true;

        logger.info({ taskId, dimension, batchIndex, generated: cases.length }, '批次生成成功');

        // 如果这批生成的数量少于请求的，说明 LLM 自行决定了数量，不再继续
        if (cases.length < batchCount) {
          remaining = 0;
        }
        break;
      } catch (error) {
        const errMsg = (error as Error).message || String(error);
        logger.warn({ taskId, dimension, batchIndex, retry, error: errMsg }, '批次生成失败');
        if (retry < MAX_BATCH_RETRIES) {
          await new Promise(r => setTimeout(r, 3000)); // 重试前等 3 秒
        }
      }
    }

    if (!success) {
      logger.warn({ taskId, dimension, batchIndex }, '批次重试全部失败，跳过');
      remaining -= batchCount;
    }
  }

  return allCases;
}

/**
 * 获取维度对应的 Prompt 模板
 */
function getPromptForDimension(dimension: Dimension): string {
  switch (dimension) {
    case 'alignment': return ALIGNMENT_PROMPT;
    case 'boundary': return BOUNDARY_PROMPT;
    case 'industry': return INDUSTRY_PROMPT;
    case 'badcase': return BADCASE_PROMPT;
    case 'security': return SECURITY_PROMPT;
    default: return ALIGNMENT_PROMPT;
  }
}

/**
 * Jaccard 去重
 * 对 turns 最后一条 user 消息分词，相似度 > 0.85 视为重复
 */
function deduplicateCases(cases: TestCase[]): TestCase[] {
  const result: TestCase[] = [];

  for (const c of cases) {
    const lastUserMsg = getLastUserMessage(c);
    const tokens = tokenize(lastUserMsg);

    let isDuplicate = false;
    for (const existing of result) {
      const existingTokens = tokenize(getLastUserMessage(existing));
      const similarity = jaccardSimilarity(tokens, existingTokens);
      if (similarity > 0.85) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(c);
    }
  }

  return result;
}

function getLastUserMessage(c: TestCase): string {
  const userTurns = c.turns.filter(t => t.role === 'user');
  return userTurns[userTurns.length - 1]?.content || '';
}

function tokenize(text: string): Set<string> {
  // 简单的中文分词：按字符 + 双字组合
  const chars = text.replace(/\s+/g, '').split('');
  const tokens = new Set<string>();
  chars.forEach(c => tokens.add(c));
  for (let i = 0; i < chars.length - 1; i++) {
    tokens.add(chars[i] + chars[i + 1]);
  }
  return tokens;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

/**
 * 自动自审：评估用例质量，过滤低质量用例
 */
async function selfReviewCases(taskId: string, cases: TestCase[]): Promise<TestCase[]> {
  if (cases.length === 0) return cases;

  // 分批审查（每批最多 20 条，避免 token 超限）
  const batchSize = 20;
  const reviewed: TestCase[] = [];

  for (let i = 0; i < cases.length; i += batchSize) {
    const batch = cases.slice(i, i + batchSize);
    const caseSummaries = batch.map((c, idx) => ({
      index: idx,
      dimension: c.dimension,
      subType: c.subType,
      lastUserMessage: getLastUserMessage(c),
      expectation: c.expectation,
      passCriteria: c.passCriteria,
    }));

    try {
      const reviewResult = await callLLMForJSON<{ reviews: SelfReviewResult[] }>({
        systemPrompt: SELF_REVIEW_PROMPT,
        userPrompt: `请评审以下 ${batch.length} 条测试用例：\n\n${JSON.stringify(caseSummaries, null, 2)}`,
        temperature: 0.3,
        model: process.env.LLM_GENERATION_MODEL || 'claude-sonnet-4-6',
      });

      // 过滤掉低质量用例
      const reviews = reviewResult.reviews || [];
      batch.forEach((c, idx) => {
        const review = reviews.find(r => r.caseIndex === idx);
        if (!review || !review.shouldRegenerate) {
          reviewed.push(c);
        } else {
          logger.info({ taskId, caseId: c.id, reason: review.reason }, '用例被自审过滤');
        }
      });
    } catch (error) {
      // 自审失败不阻塞，保留所有用例
      logger.warn({ taskId, error }, '自审调用失败，保留所有用例');
      reviewed.push(...batch);
    }
  }

  return reviewed;
}
