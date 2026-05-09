import { Worker, type Job } from 'bullmq';
import { connection } from '../lib/queue';
import { generateTestCases } from '../lib/generator';
import { createAdapter } from '../lib/adapters/base';
import { db, schema } from '../lib/db';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { createTaskLogger } from '../lib/logger';
import type { TaskConfig, Dimension } from '../lib/types';

const logger = createTaskLogger('generation-worker');

interface GenerationJobData {
  taskId: string;
  config: TaskConfig;
}

/**
 * 用例生成 Worker
 * 从 generation 队列拉取任务，调用 LLM 生成测试用例
 */
export function startGenerationWorker() {
  const worker = new Worker<GenerationJobData>(
    'generation',
    async (job: Job<GenerationJobData>) => {
      const { taskId, config } = job.data;
      const taskLogger = createTaskLogger(taskId);

      taskLogger.info('开始生成测试用例');

      try {
        // 获取智能体名称：优先用户填写，其次自动获取
        let agentName: string | null = config.agentName || null;
        if (!agentName) {
          try {
            const adapter = createAdapter(config.platform, config.apiKey, config.botId);
            agentName = await adapter.getAgentName();
          } catch (err) {
            taskLogger.warn({ error: err }, '获取智能体名称失败，使用默认名称');
          }
        }
        if (agentName) {
          await db.update(schema.tasks)
            .set({ agentName })
            .where(eq(schema.tasks.id, taskId));
          taskLogger.info({ agentName }, '智能体名称已设置');
        }

        // 全 5 维度生成（industry 维度在 general 行业时跳过）
        const dimensions: Dimension[] = config.industry === 'general'
          ? ['alignment', 'boundary', 'badcase', 'security']
          : ['alignment', 'industry', 'boundary', 'badcase', 'security'];

        // 生成用例
        const testCases = await generateTestCases(taskId, config, dimensions);

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
            orderIndex: i,
            createdAt: Date.now(),
          });
        }

        // 更新任务状态为 reviewing（等待用户审核）
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
    },
    {
      connection,
      concurrency: 10,
      lockDuration: 600000, // 10 分钟锁定时间（生成 200 条用例可能需要较长时间）
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
