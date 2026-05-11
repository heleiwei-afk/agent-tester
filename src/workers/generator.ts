import { Worker, type Job } from 'bullmq';
import { connection } from '../lib/queue';
import { generateTestCases } from '../lib/generator';
import { generateTestOutline, getTestOutline, generateTestCasesFromOutline } from '../lib/generator/outline';
import { createAdapter } from '../lib/adapters/base';
import { db, schema } from '../lib/db';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { createTaskLogger } from '../lib/logger';
import type { TaskConfig, Dimension, TestCase } from '../lib/types';

const logger = createTaskLogger('generation-worker');

interface GenerationJobData {
  taskId: string;
  config: TaskConfig;
  dimensions?: Dimension[];  // 可选：只生成指定维度（用于重新生成）
}

/**
 * 用例生成 Worker
 * 支持两种 Job：
 * 1. generate-outline: 生成测试大纲
 * 2. generate-cases-from-outline: 根据大纲生成用例
 */
export function startGenerationWorker() {
  const worker = new Worker<GenerationJobData>(
    'generation',
    async (job: Job<GenerationJobData>) => {
      const { taskId, config } = job.data;
      const taskLogger = createTaskLogger(taskId);

      // 根据 Job 名称分发
      if (job.name === 'generate-outline') {
        return await handleGenerateOutline(taskId, config, taskLogger);
      } else if (job.name === 'generate-cases-from-outline') {
        return await handleGenerateCasesFromOutline(taskId, config, taskLogger);
      } else {
        // 兼容旧流程（直接生成用例，不走大纲）
        taskLogger.warn('使用旧流程生成用例（不推荐）');
        return await handleLegacyGeneration(taskId, config, job.data.dimensions, taskLogger);
      }
    },
    {
      connection,
      concurrency: 10,
      lockDuration: 600000, // 10 分钟锁定时间
    }
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, '生成 Job 失败');
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, '生成 Job 完成');
  });

  return worker;
}

/**
 * 处理大纲生成
 */
async function handleGenerateOutline(
  taskId: string,
  config: TaskConfig,
  taskLogger: any
) {
  taskLogger.info('开始生成测试大纲');

  try {
    // 1. 获取智能体名称
    let agentName: string | null = config.agentName || null;
    if (!agentName) {
      try {
        const adapter = createAdapter(config.platform, config.apiKey, config.botId);
        agentName = await adapter.getAgentName();
      } catch (err) {
        taskLogger.warn({ error: err }, '获取智能体名称失败');
      }
    }
    if (agentName) {
      await db.update(schema.tasks)
        .set({ agentName })
        .where(eq(schema.tasks.id, taskId));
    }

    // 2. 获取 system prompt
    let systemPrompt = config.systemPrompt || null; // 用户手动粘贴的
    if (!systemPrompt) {
      try {
        const adapter = createAdapter(config.platform, config.apiKey, config.botId);
        systemPrompt = await adapter.getSystemPrompt();
        taskLogger.info('自动获取 system prompt 成功');
      } catch (err) {
        taskLogger.warn({ error: err }, '自动获取 system prompt 失败');
      }
    }

    // 3. 生成大纲
    const outline = await generateTestOutline(taskId, config, systemPrompt);

    // 4. 更新任务状态为 outline_review
    await db.update(schema.tasks)
      .set({ status: 'outline_review' })
      .where(eq(schema.tasks.id, taskId));

    taskLogger.info({ goalCount: outline.testGoals.length }, '大纲生成完成，等待用户审核');
  } catch (error: any) {
    taskLogger.error({ error: error.message }, '大纲生成失败');

    await db.update(schema.tasks)
      .set({
        status: 'failed',
        errorMessage: `大纲生成失败: ${error.message}`,
        finishedAt: Date.now(),
      })
      .where(eq(schema.tasks.id, taskId));

    throw error;
  }
}

/**
 * 处理基于大纲生成用例
 */
async function handleGenerateCasesFromOutline(
  taskId: string,
  config: TaskConfig,
  taskLogger: any
) {
  taskLogger.info('开始根据大纲生成用例');

  try {
    // 1. 获取大纲
    const outline = await getTestOutline(taskId);
    if (!outline) {
      throw new Error('大纲不存在');
    }

    // 2. 生成用例
    const testCases = await generateTestCasesFromOutline(taskId, config, outline);

    // 3. 写入数据库
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      await db.insert(schema.cases).values({
        id: tc.id,
        taskId,
        dimension: tc.dimension,
        subType: tc.subType,
        turnsJson: JSON.stringify(tc.turns),
        expectation: tc.expectation,
        passCriteriaJson: JSON.stringify(tc.passCriteria),
        weight: tc.weight,
        evaluationStrategy: tc.evaluationStrategy,
        checkpoints: tc.checkpoints ? JSON.stringify(tc.checkpoints) : null,
        evidenceHints: tc.evidenceHints ? JSON.stringify(tc.evidenceHints) : null,
        status: 'pending',
        newSession: tc.newSession ? 1 : 0,
        goalId: tc.goalId || null,
        scenarioId: tc.scenarioId || null,
        pointId: tc.pointId || null,
        orderIndex: tc.orderIndex,
        createdAt: Date.now(),
      });
    }

    // 4. 更新任务状态为 reviewing
    await db.update(schema.tasks)
      .set({
        status: 'reviewing',
        totalCases: testCases.length,
      })
      .where(eq(schema.tasks.id, taskId));

    taskLogger.info({ caseCount: testCases.length }, '用例生成完成，等待用户审核');
  } catch (error: any) {
    taskLogger.error({ error: error.message }, '用例生成失败');

    await db.update(schema.tasks)
      .set({
        status: 'failed',
        errorMessage: `用例生成失败: ${error.message}`,
        finishedAt: Date.now(),
      })
      .where(eq(schema.tasks.id, taskId));

    throw error;
  }
}

/**
 * 兼容旧流程（直接生成用例，不走大纲）
 */
async function handleLegacyGeneration(
  taskId: string,
  config: TaskConfig,
  specifiedDimensions: Dimension[] | undefined,
  taskLogger: any
) {
  taskLogger.info('开始生成测试用例（旧流程）');

  try {
    // 获取智能体名称
    let agentName: string | null = config.agentName || null;
    if (!agentName) {
      try {
        const adapter = createAdapter(config.platform, config.apiKey, config.botId);
        agentName = await adapter.getAgentName();
      } catch (err) {
        taskLogger.warn({ error: err }, '获取智能体名称失败');
      }
    }
    if (agentName) {
      await db.update(schema.tasks)
        .set({ agentName })
        .where(eq(schema.tasks.id, taskId));
    }

    // 确定维度
    const dimensions: Dimension[] = specifiedDimensions || (
      config.industry === 'general'
        ? ['alignment', 'boundary', 'badcase', 'security']
        : ['alignment', 'industry', 'boundary', 'badcase', 'security']
    );

    // 生成用例
    const testCases = await generateTestCases(taskId, config, dimensions);

    // 如果有测试素材，插入打招呼用例
    if (config.testContext) {
      const greetingCase: TestCase = {
        id: uuid(),
        taskId,
        dimension: 'alignment',
        subType: 'greeting_with_context',
        turns: [{ role: 'user', content: '你好' }],
        expectation: '智能体应该礼貌回应',
        passCriteria: ['包含问候语', '语气友好'],
        weight: 3,
        evaluationStrategy: 'hybrid',
        status: 'pending',
        newSession: true,
        orderIndex: 0,
      };
      testCases.unshift(greetingCase);
    }

    // 写入数据库
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      await db.insert(schema.cases).values({
        id: tc.id,
        taskId,
        dimension: tc.dimension,
        subType: tc.subType,
        turnsJson: JSON.stringify(tc.turns),
        expectation: tc.expectation,
        passCriteriaJson: JSON.stringify(tc.passCriteria),
        weight: tc.weight,
        evaluationStrategy: tc.evaluationStrategy,
        checkpoints: tc.checkpoints ? JSON.stringify(tc.checkpoints) : null,
        evidenceHints: tc.evidenceHints ? JSON.stringify(tc.evidenceHints) : null,
        status: 'pending',
        newSession: tc.newSession ? 1 : 0,
        orderIndex: i,
        createdAt: Date.now(),
      });
    }

    // 更新任务状态
    await db.update(schema.tasks)
      .set({
        status: 'reviewing',
        totalCases: testCases.length,
      })
      .where(eq(schema.tasks.id, taskId));

    taskLogger.info({ caseCount: testCases.length }, '用例生成完成');
  } catch (error: any) {
    taskLogger.error({ error: error.message }, '用例生成失败');

    await db.update(schema.tasks)
      .set({
        status: 'failed',
        errorMessage: `用例生成失败: ${error.message}`,
        finishedAt: Date.now(),
      })
      .where(eq(schema.tasks.id, taskId));

    throw error;
  }
}
