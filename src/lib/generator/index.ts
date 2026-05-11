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
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';

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
 * 流程：能力提取 → 用户画像推断 → 分维度生成（写入进度） → 去重 → 自审过滤
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

  // 初始化 generation_progress 记录
  for (const dim of dimensions) {
    const existing = await db.select().from(schema.generationProgress)
      .where(and(
        eq(schema.generationProgress.taskId, taskId),
        eq(schema.generationProgress.dimension, dim)
      ));
    if (existing.length === 0) {
      await db.insert(schema.generationProgress).values({
        id: uuid(),
        taskId,
        dimension: dim,
        status: 'pending',
        targetCount: caseCountPerDimension[dim] || 0,
        generatedCount: 0,
        afterDedupCount: 0,
        afterReviewCount: 0,
        batchTotal: 0,
        batchSuccess: 0,
        batchFailed: 0,
        errorMessages: '[]',
        startedAt: null,
        finishedAt: null,
      });
    } else {
      // 重新生成时重置状态
      await db.update(schema.generationProgress)
        .set({
          status: 'pending',
          targetCount: caseCountPerDimension[dim] || 0,
          generatedCount: 0,
          afterDedupCount: 0,
          afterReviewCount: 0,
          batchTotal: 0,
          batchSuccess: 0,
          batchFailed: 0,
          errorMessages: '[]',
          startedAt: null,
          finishedAt: null,
        })
        .where(and(
          eq(schema.generationProgress.taskId, taskId),
          eq(schema.generationProgress.dimension, dim)
        ));
    }
  }

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

  // 更新每个维度的去重后数量
  for (const dim of dimensions) {
    const dimCases = deduplicated.filter(c => c.dimension === dim);
    await db.update(schema.generationProgress)
      .set({ afterDedupCount: dimCases.length })
      .where(and(
        eq(schema.generationProgress.taskId, taskId),
        eq(schema.generationProgress.dimension, dim)
      ));
  }

  // 第五步：自审
  const reviewed = await selfReviewCases(taskId, deduplicated);
  logger.info({ taskId, final: reviewed.length }, '自审完成，用例生成结束');

  // 更新每个维度的自审后数量
  for (const dim of dimensions) {
    const dimCases = reviewed.filter(c => c.dimension === dim);
    await db.update(schema.generationProgress)
      .set({ afterReviewCount: dimCases.length })
      .where(and(
        eq(schema.generationProgress.taskId, taskId),
        eq(schema.generationProgress.dimension, dim)
      ));
  }

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
  // 最终降级：返回基础能力
  logger.warn('能力提取全部失败，使用降级方案');
  return {
    capabilities: [{
      name: '核心功能',
      description: config.expectedBehavior,
      importance: '核心',
      interactionType: '对话',
      examples: ['用户直接提问'],
    }],
    boundaries: [{ description: '超出功能范围的请求', reason: '非设计用途' }],
    targetScenarios: ['日常使用'],
  };
}

/**
 * 推断用户画像（带重试+降级）
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

  const entries = Object.entries(activeRatios);
  for (let i = 0; i < entries.length; i++) {
    const [dim, ratio] = entries[i];
    if (i === entries.length - 1) {
      result[dim] = total - allocated;
    } else {
      result[dim] = Math.round(total * (ratio / sum));
      allocated += result[dim];
    }
  }

  return result;
}

/**
 * 按维度生成用例（带进度追踪）
 */
async function generateByDimension(
  taskId: string,
  config: TaskConfig,
  dimension: Dimension,
  count: number,
  capabilities: CapabilityResult,
  userProfile: UserProfileResult
): Promise<TestCase[]> {
  // 标记维度开始
  await db.update(schema.generationProgress)
    .set({ status: 'generating', startedAt: Date.now() })
    .where(and(
      eq(schema.generationProgress.taskId, taskId),
      eq(schema.generationProgress.dimension, dimension)
    ));

  const promptTemplate = await getPromptForDimension(dimension);
  const variables: Record<string, string> = {
    capabilities: JSON.stringify(capabilities, null, 2),
    expectedBehavior: config.expectedBehavior,
    industry: config.industry,
    userProfile: JSON.stringify(userProfile, null, 2),
    multiTurnRatio: String(config.multiTurnRatio),
    industryRules: dimension === 'industry'
      ? getIndustryRules(config.industry)
      : '',
    boundaries: JSON.stringify(capabilities.boundaries || [], null, 2),
  };

  // 替换模板变量
  let prompt = promptTemplate;
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  // 注入 few-shot 示例
  const fewShot = await getFewShotExamples(dimension);
  if (fewShot) {
    prompt += fewShot;
  }

  // 分批生成：每批最多 10 条，避免 JSON 过长被截断
  const BATCH_SIZE = 10;
  const MAX_BATCH_RETRIES = 2;
  const allCases: TestCase[] = [];
  let remaining = count;
  let batchIndex = 0;
  let consecutiveShortBatches = 0; // 连续返回不足的批次数

  while (remaining > 0) {
    const batchCount = Math.min(remaining, BATCH_SIZE);
    batchIndex++;
    const userPrompt = `请生成 ${batchCount} 条测试用例。\n\n${prompt}`;
    let success = false;

    // 更新批次总数
    await db.update(schema.generationProgress)
      .set({ batchTotal: batchIndex })
      .where(and(
        eq(schema.generationProgress.taskId, taskId),
        eq(schema.generationProgress.dimension, dimension)
      ));

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
          newSession: false,
          orderIndex: allCases.length + index,
        }));

        allCases.push(...cases);
        remaining -= cases.length;
        success = true;

        // 更新进度：成功批次 + 已生成数量
        await db.update(schema.generationProgress)
          .set({
            batchSuccess: allCases.length > 0 ? batchIndex - (await getFailedBatchCount(taskId, dimension)) : 0,
            generatedCount: allCases.length,
          })
          .where(and(
            eq(schema.generationProgress.taskId, taskId),
            eq(schema.generationProgress.dimension, dimension)
          ));

        logger.info({ taskId, dimension, batchIndex, generated: cases.length }, '批次生成成功');

        // 修复：LLM 返回不足时不直接结束，而是继续尝试
        if (cases.length < batchCount) {
          consecutiveShortBatches++;
          // 连续 2 批返回不足才结束该维度（避免无限循环）
          if (consecutiveShortBatches >= 2) {
            logger.info({ taskId, dimension, consecutiveShortBatches }, '连续多批返回不足，结束该维度');
            remaining = 0;
          }
        } else {
          consecutiveShortBatches = 0;
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
      // 更新进度：失败批次 + 错误信息
      const progressRow = await db.select().from(schema.generationProgress)
        .where(and(
          eq(schema.generationProgress.taskId, taskId),
          eq(schema.generationProgress.dimension, dimension)
        ));
      const existingErrors: string[] = progressRow[0]?.errorMessages
        ? JSON.parse(progressRow[0].errorMessages)
        : [];
      existingErrors.push(`批次${batchIndex}: ${MAX_BATCH_RETRIES + 1}次重试全部失败`);

      await db.update(schema.generationProgress)
        .set({
          batchFailed: existingErrors.length,
          errorMessages: JSON.stringify(existingErrors),
        })
        .where(and(
          eq(schema.generationProgress.taskId, taskId),
          eq(schema.generationProgress.dimension, dimension)
        ));

      logger.warn({ taskId, dimension, batchIndex }, '批次重试全部失败，跳过');
      remaining -= batchCount;
    }
  }

  // 标记维度完成/失败
  const finalStatus = allCases.length > 0 ? 'done' : 'failed';
  await db.update(schema.generationProgress)
    .set({
      status: finalStatus,
      generatedCount: allCases.length,
      finishedAt: Date.now(),
    })
    .where(and(
      eq(schema.generationProgress.taskId, taskId),
      eq(schema.generationProgress.dimension, dimension)
    ));

  return allCases;
}

/**
 * 获取指定维度的失败批次数
 */
async function getFailedBatchCount(taskId: string, dimension: string): Promise<number> {
  const row = await db.select().from(schema.generationProgress)
    .where(and(
      eq(schema.generationProgress.taskId, taskId),
      eq(schema.generationProgress.dimension, dimension)
    ));
  return row[0]?.batchFailed || 0;
}

/**
 * 获取维度 Prompt（优先从数据库读取，降级到代码默认值）
 */
async function getPromptForDimension(dimension: Dimension): Promise<string> {
  try {
    const dbTemplate = await db.select().from(schema.testTemplates)
      .where(and(
        eq(schema.testTemplates.type, 'dimension'),
        eq(schema.testTemplates.dimension, dimension),
        eq(schema.testTemplates.isActive, 1)
      ));
    if (dbTemplate.length > 0) {
      return dbTemplate[0].content;
    }
  } catch {}

  // 降级到代码默认值
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
 * 获取 Good/Bad Case 示例，用于 few-shot 注入
 */
async function getFewShotExamples(dimension: Dimension): Promise<string> {
  try {
    const goodCases = await db.select().from(schema.testTemplates)
      .where(and(
        eq(schema.testTemplates.type, 'good_case'),
        eq(schema.testTemplates.dimension, dimension),
        eq(schema.testTemplates.isActive, 1)
      ));
    const badCases = await db.select().from(schema.testTemplates)
      .where(and(
        eq(schema.testTemplates.type, 'bad_case'),
        eq(schema.testTemplates.dimension, dimension),
        eq(schema.testTemplates.isActive, 1)
      ));

    if (goodCases.length === 0 && badCases.length === 0) return '';

    let fewShot = '\n\n【参考示例】\n';
    if (goodCases.length > 0) {
      fewShot += '\n好的用例示例（请参考这种风格和质量）：\n';
      for (const gc of goodCases.slice(0, 3)) {
        fewShot += `- ${gc.name}: ${gc.content}\n`;
      }
    }
    if (badCases.length > 0) {
      fewShot += '\n不好的用例示例（请避免这种问题）：\n';
      for (const bc of badCases.slice(0, 3)) {
        fewShot += `- ${bc.name}: ${bc.content}\n`;
      }
    }
    return fewShot;
  } catch {
    return '';
  }
}

/**
 * 去重：基于 Jaccard 相似度
 */
function deduplicateCases(cases: TestCase[]): TestCase[] {
  const SIMILARITY_THRESHOLD = 0.85;
  const result: TestCase[] = [];

  for (const c of cases) {
    const lastMsg = getLastUserMessage(c);
    const isDuplicate = result.some(existing => {
      const existingMsg = getLastUserMessage(existing);
      return jaccardSimilarity(lastMsg, existingMsg) > SIMILARITY_THRESHOLD;
    });
    if (!isDuplicate) {
      result.push(c);
    }
  }

  return result;
}

/**
 * 获取用例最后一条用户消息
 */
function getLastUserMessage(c: TestCase): string {
  const userTurns = c.turns.filter(t => t.role === 'user');
  return userTurns[userTurns.length - 1]?.content || '';
}

/**
 * Jaccard 相似度（基于字符 bigram）
 */
function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();

  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));

  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return intersection / (bigramsA.size + bigramsB.size - intersection);
}

/**
 * 自审过滤低质量用例
 */
async function selfReviewCases(taskId: string, cases: TestCase[]): Promise<TestCase[]> {
  if (cases.length === 0) return [];

  const reviewed: TestCase[] = [];
  const batchSize = 10;

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
