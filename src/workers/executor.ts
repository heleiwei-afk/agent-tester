import { Worker, type Job } from 'bullmq';
import { connection } from '../lib/queue';
import { createAdapter } from '../lib/adapters/base';
import { evaluateCase } from '../lib/evaluator';
import { db, schema } from '../lib/db';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { createTaskLogger } from '../lib/logger';
import { formatCaseResult, generateFinalSummary } from '../lib/report';
import { backupDatabase } from '../lib/db/backup';
import type { TestCase, ChatMessage, Verdict, TaskConfig } from '../lib/types';

const logger = createTaskLogger('executor-worker');

interface SerialExecutionJobData {
  taskId: string;
  caseIds: string[];
  platform: string;
  apiKey: string;
  botId: string;
  testContext: string | null; // 测试素材
  timeoutSec: number;
  retryCount: number;
}

/**
 * 执行器 Worker（串行模式）
 * 
 * 核心逻辑：
 * 1. 同一任务的所有用例共享会话，按 orderIndex 顺序串行执行
 * 2. 遇到 newSession=1 的用例时，关闭旧会话，创建新会话
 * 3. 每次新会话的第一轮自动注入 testContext（测试素材），作为"打招呼"用例评分
 * 4. 每条用例执行完后立即评估 + 追加报告
 * 5. 全部完成后生成最终总结
 */
export function startExecutionWorker() {
  const concurrency = parseInt(process.env.MAX_CONCURRENCY || '10');

  const worker = new Worker<SerialExecutionJobData>(
    'execution',
    async (job: Job<SerialExecutionJobData>) => {
      const { taskId, caseIds, platform, apiKey, botId, testContext, timeoutSec, retryCount } = job.data;
      const taskLogger = createTaskLogger(taskId);

      taskLogger.info({ totalCases: caseIds.length, hasTestContext: !!testContext }, '开始串行执行任务');

      const adapter = createAdapter(platform, apiKey, botId);

      // 创建首个会话
      let conversationId = await adapter.createConversation();
      let isFirstMessageInSession = true;

      // 如果有测试素材，首轮注入
      if (testContext) {
        await injectTestContext(adapter, conversationId, testContext, taskId, timeoutSec);
        isFirstMessageInSession = false;
      }

      // 按顺序执行每条用例
      for (let i = 0; i < caseIds.length; i++) {
        const caseId = caseIds[i];
        const caseLogger = createTaskLogger(taskId, caseId);

        // 从数据库获取用例详情
        const caseRow = await db.query.cases.findFirst({
          where: eq(schema.cases.id, caseId),
        });
        if (!caseRow) {
          caseLogger.warn('用例不存在，跳过');
          continue;
        }

        // 检查是否需要新会话
        if (caseRow.newSession && i > 0) {
          caseLogger.info('开始新会话');
          await adapter.closeConversation(conversationId);
          conversationId = await adapter.createConversation();
          isFirstMessageInSession = true;

          // 新会话注入测试素材
          if (testContext) {
            await injectTestContext(adapter, conversationId, testContext, taskId, timeoutSec);
            isFirstMessageInSession = false;
          }
        }

        // 更新用例状态为 running
        await db.update(schema.cases)
          .set({ status: 'running' })
          .where(eq(schema.cases.id, caseId));

        // 执行用例
        await executeCase(
          caseRow, adapter, conversationId, taskId, timeoutSec, retryCount, caseLogger
        );

        // 轮次间等待 500ms
        if (i < caseIds.length - 1) {
          await sleep(500);
        }
      }

      // 关闭最后一个会话
      await adapter.closeConversation(conversationId);

      // 检查任务是否全部完成
      await checkTaskCompletion(taskId);

      taskLogger.info('串行执行完成');
    },
    {
      connection,
      concurrency, // 多个任务可以并行（每个任务内部串行）
      lockDuration: 1800000, // 30 分钟锁定（串行执行可能很长）
    }
  );

  worker.on('failed', async (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'Job 最终失败');
    if (job?.data?.taskId) {
      await checkTaskCompletion(job.data.taskId);
    }
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job 完成');
  });

  return worker;
}

/**
 * 注入测试素材（新会话首轮）
 * 作为"打招呼"用例，记录响应并评分
 */
async function injectTestContext(
  adapter: any,
  conversationId: string,
  testContext: string,
  taskId: string,
  timeoutSec: number
): Promise<void> {
  const contextLogger = createTaskLogger(taskId, 'test-context');
  contextLogger.info('注入测试素材');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000);

    const response = await adapter.invoke({
      conversationId,
      userMessage: testContext,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    contextLogger.info({ latency: response.latencyMs }, '测试素材注入完成，智能体已回复');
  } catch (error: any) {
    contextLogger.warn({ error: error.message }, '测试素材注入失败，继续执行');
  }
}

/**
 * 执行单条用例（含重试、评估、报告追加）
 */
async function executeCase(
  caseRow: any,
  adapter: any,
  conversationId: string,
  taskId: string,
  timeoutSec: number,
  retryCount: number,
  caseLogger: any
): Promise<void> {
  const caseId = caseRow.id;
  const turns: ChatMessage[] = JSON.parse(caseRow.turnsJson);
  const userTurns = turns.filter(t => t.role === 'user');

  let lastAttemptError: any = null;

  // 重试逻辑
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const startTime = Date.now();
      let finalResponse = '';
      let rawResponse: unknown = null;
      let totalLatency = 0;
      let totalTokens = 0;

      // 执行所有 user turns（单条用例内的多轮）
      for (let t = 0; t < userTurns.length; t++) {
        const userMsg = userTurns[t].content;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000);

        try {
          const response = await adapter.invoke({
            conversationId,
            userMessage: userMsg,
            signal: controller.signal,
          });

          clearTimeout(timeout);
          finalResponse = response.content;
          rawResponse = response.raw;
          totalLatency += response.latencyMs;
          if (response.tokenUsage) {
            totalTokens += response.tokenUsage.input + response.tokenUsage.output;
          }

          // 多轮间等待
          if (t < userTurns.length - 1) {
            await sleep(500);
          }
        } catch (error) {
          clearTimeout(timeout);
          throw error;
        }
      }

      // 写入执行结果
      await db.insert(schema.results).values({
        id: uuid(),
        caseId,
        taskId,
        rawResponseJson: JSON.stringify(rawResponse),
        responseContent: finalResponse,
        latencyMs: totalLatency,
        tokenCount: totalTokens,
        errorType: null,
        errorMsg: null,
        retryCount: attempt,
        createdAt: Date.now(),
      });

      // 构建 TestCase 对象用于评估
      const testCase: TestCase = {
        id: caseRow.id,
        taskId: caseRow.taskId,
        dimension: caseRow.dimension as any,
        subType: caseRow.subType,
        turns: JSON.parse(caseRow.turnsJson),
        expectation: caseRow.expectation,
        passCriteria: JSON.parse(caseRow.passCriteriaJson),
        weight: caseRow.weight,
        evaluationStrategy: caseRow.evaluationStrategy as any,
        status: 'done',
        newSession: caseRow.newSession === 1,
        orderIndex: caseRow.orderIndex,
      };

      // 评估（独立 try/catch）
      let verdict: Verdict;
      try {
        verdict = await evaluateCase(testCase, finalResponse, taskId);
      } catch (evalError: any) {
        caseLogger.error({ error: evalError.message }, '评估异常');
        verdict = {
          caseId,
          pass: false,
          score: 0,
          reason: `评估器异常：${evalError.message || '未知错误'}，需人工复核`,
          confidence: 0,
          strategyUsed: 'llm',
          evidence: '',
          dualJudge: { judge1: { pass: false, score: 0, reason: '评估失败' }, judge2: { pass: false, score: 0, reason: '评估失败' }, consensus: true },
          hallucinationCheck: { detected: false },
          needsHumanReview: true,
        };
      }

      // 写入判分
      await db.insert(schema.verdicts).values({
        id: uuid(),
        caseId,
        taskId,
        pass: verdict.pass ? 1 : 0,
        score: verdict.score,
        reason: verdict.reason,
        confidence: verdict.confidence,
        severity: verdict.severity || null,
        suggestion: verdict.suggestion || null,
        evidence: verdict.evidence || null,
        strategyUsed: verdict.strategyUsed,
        dualJudgeJson: JSON.stringify(verdict.dualJudge),
        hallucinationJson: JSON.stringify(verdict.hallucinationCheck),
        perTurnScoresJson: verdict.perTurnScores ? JSON.stringify(verdict.perTurnScores) : null,
        needsHumanReview: verdict.needsHumanReview ? 1 : 0,
        createdAt: Date.now(),
      });

      // 增量追加报告
      const caseResult = formatCaseResult(caseRow.orderIndex, testCase, verdict, finalResponse);
      await db.run(sql`UPDATE tasks SET report_content = COALESCE(report_content, '') || ${caseResult} WHERE id = ${taskId}`);

      // 更新用例状态
      await db.update(schema.cases)
        .set({ status: 'done' })
        .where(eq(schema.cases.id, caseId));

      caseLogger.info({ latency: totalLatency, pass: verdict.pass, score: verdict.score }, '用例执行完成');
      return; // 成功，退出重试循环

    } catch (error: any) {
      lastAttemptError = error;
      const errorType = error.type || (error.name === 'AbortError' ? 'timeout' : 'unknown');

      caseLogger.warn({ attempt, errorType, error: error.message }, '用例执行失败');

      // 限流：等待后重试
      if (errorType === 'rate_limit' && attempt < retryCount) {
        const delay = 5000 + Math.random() * 5000;
        await sleep(delay);
        continue;
      }

      // 其他错误：指数退避重试
      if (attempt < retryCount) {
        await sleep(2000 * Math.pow(2, attempt));
        continue;
      }
    }
  }

  // 所有重试都失败了
  const errorType = lastAttemptError?.type || 'unknown';
  const errorMsg = lastAttemptError?.message || '未知错误';

  await db.insert(schema.results).values({
    id: uuid(),
    caseId,
    taskId,
    rawResponseJson: null,
    responseContent: null,
    latencyMs: 0,
    tokenCount: 0,
    errorType,
    errorMsg,
    retryCount,
    createdAt: Date.now(),
  });

  const finalStatus = errorType === 'timeout' ? 'timeout' : 'failed';
  await db.update(schema.cases)
    .set({ status: finalStatus })
    .where(eq(schema.cases.id, caseId));

  caseLogger.error({ errorType, errorMsg }, '用例最终失败');
}

/**
 * 检查任务是否全部完成
 */
async function checkTaskCompletion(taskId: string) {
  const taskLogger = createTaskLogger(taskId);

  const updateResult = await db.run(
    sql`UPDATE tasks SET status = 'completing' WHERE id = ${taskId} AND status = 'running' AND (SELECT count(*) FROM cases WHERE task_id = ${taskId} AND status IN ('pending', 'running')) = 0`
  );

  if ((updateResult as any).changes === 0) return;

  taskLogger.info('所有用例执行完成，开始生成最终报告');

  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });
  if (!task) return;

  const verdicts = await db.select().from(schema.verdicts)
    .where(eq(schema.verdicts.taskId, taskId));
  const cases = await db.select().from(schema.cases)
    .where(eq(schema.cases.taskId, taskId));

  // 计算评分
  const passedCases = verdicts.filter(v => v.pass === 1).length;
  const failedCases = verdicts.filter(v => v.pass === 0).length;
  const executionFailedCases = cases.filter(c => c.status === 'failed' || c.status === 'timeout').length;
  const totalWeight = cases.reduce((sum, c) => sum + c.weight, 0);
  const weightedScore = verdicts.reduce((sum, v) => {
    const c = cases.find(c => c.id === v.caseId);
    return sum + v.score * (c?.weight || 3);
  }, 0);
  const overallScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;

  // 全部执行失败
  if (verdicts.length === 0) {
    await db.update(schema.tasks).set({
      status: 'failed',
      finishedAt: Date.now(),
      overallScore: 0,
      passedCases: 0,
      failedCases: executionFailedCases,
      errorMessage: `所有 ${executionFailedCases} 条用例执行失败，请检查智能体平台状态`,
    }).where(eq(schema.tasks.id, taskId));
    taskLogger.error({ executionFailedCases }, '任务失败：所有用例执行失败');
    backupDatabase('task-failed').catch(() => {});
    return;
  }

  // 生成最终报告
  const config: TaskConfig = JSON.parse(task.configJson);
  const testCases: TestCase[] = cases.map(c => ({
    id: c.id, taskId: c.taskId, dimension: c.dimension as any,
    subType: c.subType, turns: JSON.parse(c.turnsJson),
    expectation: c.expectation, passCriteria: JSON.parse(c.passCriteriaJson),
    weight: c.weight, evaluationStrategy: c.evaluationStrategy as any,
    status: c.status as any, newSession: c.newSession === 1, orderIndex: c.orderIndex,
  }));
  const verdictList: Verdict[] = verdicts.map(v => ({
    caseId: v.caseId, pass: v.pass === 1, score: v.score,
    reason: v.reason, confidence: v.confidence,
    severity: v.severity as any, suggestion: v.suggestion || undefined,
    evidence: v.evidence || '', strategyUsed: v.strategyUsed as any,
    dualJudge: v.dualJudgeJson ? JSON.parse(v.dualJudgeJson) : { judge1: {}, judge2: {}, consensus: true },
    hallucinationCheck: v.hallucinationJson ? JSON.parse(v.hallucinationJson) : { detected: false },
    needsHumanReview: v.needsHumanReview === 1,
  }));

  let finalSummary: string | null = null;
  for (let retry = 0; retry <= 1; retry++) {
    try {
      finalSummary = await generateFinalSummary(
        config, task.agentName || `${task.platform}-${task.botId.slice(-6)}`,
        testCases, verdictList, task.startedAt || task.createdAt, Date.now()
      );
      break;
    } catch (error: any) {
      taskLogger.warn({ error: error.message, retry }, '最终报告生成失败');
      if (retry === 0) await sleep(5000);
    }
  }

  const existingContent = task.reportContent || '';

  if (finalSummary) {
    const fullReport = finalSummary + '\n---\n\n## 测试用例详细结果\n\n' + existingContent;
    await db.update(schema.tasks).set({
      status: 'done', finishedAt: Date.now(), overallScore,
      passedCases, failedCases, reportContent: fullReport, improvementReport: null,
    }).where(eq(schema.tasks.id, taskId));
    taskLogger.info({ overallScore, passedCases, failedCases }, '任务完成，报告已生成');
  } else {
    const passRate = testCases.length > 0 ? Math.round((passedCases / testCases.length) * 100) : 0;
    const simpleSummary = `# 智能体测试报告\n\n## 测试概况\n\n- 综合评分：${overallScore}/100\n- 通过率：${passRate}%（${passedCases}/${testCases.length}）\n- 失败用例：${failedCases} 条\n\n---\n\n## 测试用例详细结果\n\n`;
    await db.update(schema.tasks).set({
      status: 'done', finishedAt: Date.now(), overallScore,
      passedCases, failedCases, reportContent: simpleSummary + existingContent,
    }).where(eq(schema.tasks.id, taskId));
    taskLogger.warn({ overallScore }, '任务完成，报告使用简化版本');
  }

  backupDatabase('task-done').catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
