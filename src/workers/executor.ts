import { Worker, type Job } from 'bullmq';
import { connection } from '../lib/queue';
import { createAdapter } from '../lib/adapters/base';
import { evaluateCase } from '../lib/evaluator';
import { db, schema } from '../lib/db';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { createTaskLogger } from '../lib/logger';
import { formatCaseResult, generateFinalSummary } from '../lib/report';
import type { TestCase, ChatMessage, Verdict, TaskConfig } from '../lib/types';

const logger = createTaskLogger('executor-worker');

interface ExecutionJobData {
  caseId: string;
  taskId: string;
  platform: string;
  apiKey: string;
  botId: string;
  turns: ChatMessage[];
  timeoutSec: number;
  retryCount: number;
}

/**
 * 执行器 Worker
 * 从 execution 队列拉取任务，调用平台 API，执行评估
 */
export function startExecutionWorker() {
  const concurrency = parseInt(process.env.MAX_CONCURRENCY || '5');

  const worker = new Worker<ExecutionJobData>(
    'execution',
    async (job: Job<ExecutionJobData>) => {
      const { caseId, taskId, platform, apiKey, botId, turns, timeoutSec } = job.data;
      const caseLogger = createTaskLogger(taskId, caseId);

      caseLogger.info('开始执行用例');

      // 更新用例状态为 running
      await db.update(schema.cases)
        .set({ status: 'running' })
        .where(eq(schema.cases.id, caseId));

      const adapter = createAdapter(platform, apiKey, botId);
      const startTime = Date.now();

      try {
        // 创建会话
        const conversationId = await adapter.createConversation();

        // 执行对话（支持多轮）
        let finalResponse = '';
        let rawResponse: unknown = null;
        let totalLatency = 0;
        let totalTokens = 0;

        const userTurns = turns.filter(t => t.role === 'user');
        const history: ChatMessage[] = [];

        for (let i = 0; i < userTurns.length; i++) {
          const userMsg = userTurns[i].content;

          // 设置超时
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000);

          try {
            const response = await adapter.invoke({
              conversationId,
              userMessage: userMsg,
              history: history.length > 0 ? history : undefined,
              signal: controller.signal,
            });

            clearTimeout(timeout);

            // 记录历史
            history.push({ role: 'user', content: userMsg });
            history.push({ role: 'assistant', content: response.content });

            finalResponse = response.content;
            rawResponse = response.raw;
            totalLatency += response.latencyMs;
            if (response.tokenUsage) {
              totalTokens += response.tokenUsage.input + response.tokenUsage.output;
            }

            // 多轮之间等待 500ms
            if (i < userTurns.length - 1) {
              await sleep(500);
            }
          } catch (error) {
            clearTimeout(timeout);
            throw error;
          }
        }

        // 清理会话
        await adapter.closeConversation(conversationId);

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
          retryCount: job.attemptsMade,
          createdAt: Date.now(),
        });

        // 获取完整的 TestCase 信息用于评估
        const caseRow = await db.query.cases.findFirst({
          where: eq(schema.cases.id, caseId),
        });

        if (caseRow) {
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
            orderIndex: caseRow.orderIndex,
          };

          // 执行评估（独立 try/catch，评估失败不重试整个 Job）
          let verdict: Verdict;
          try {
            verdict = await evaluateCase(testCase, finalResponse, taskId);
          } catch (evalError: any) {
            caseLogger.error({ error: evalError.message }, '评估异常，标记为需人工复核');
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

          // 写入判分结果
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

          // 增量追加报告：将本条用例结果追加到实时报告
          const caseResult = formatCaseResult(
            testCase.orderIndex,
            testCase,
            verdict,
            finalResponse
          );
          await db.run(sql`UPDATE tasks SET report_content = COALESCE(report_content, '') || ${caseResult} WHERE id = ${taskId}`);
        }

        // 更新用例状态
        await db.update(schema.cases)
          .set({ status: 'done' })
          .where(eq(schema.cases.id, caseId));

        caseLogger.info({ latency: totalLatency }, '用例执行完成');

        // 检查任务是否全部完成
        await checkTaskCompletion(taskId);

      } catch (error: any) {
        const latency = Date.now() - startTime;
        const errorType = error.type || (error.name === 'AbortError' ? 'timeout' : 'unknown');
        const errorMsg = error.message || '未知错误';

        caseLogger.error({ error: errorMsg, errorType }, '用例执行失败');

        // 写入错误结果
        await db.insert(schema.results).values({
          id: uuid(),
          caseId,
          taskId,
          rawResponseJson: null,
          responseContent: null,
          latencyMs: latency,
          tokenCount: 0,
          errorType,
          errorMsg,
          retryCount: job.attemptsMade,
          createdAt: Date.now(),
        });

        // 更新用例状态
        const finalStatus = errorType === 'timeout' ? 'timeout' : 'failed';
        await db.update(schema.cases)
          .set({ status: finalStatus })
          .where(eq(schema.cases.id, caseId));

        // 限流错误：延迟重试 + 降速
        if (errorType === 'rate_limit') {
          const delay = 5000 + Math.random() * 5000; // 5-10秒随机延迟
          logger.warn({ taskId, caseId, delay }, '触发限流，延迟重试');
          await job.moveToDelayed(Date.now() + delay);
          // 通过 BullMQ rate limiter 实现临时降速
          // Worker 会自动在 limiter.duration 内限制 max 个 job
          return;
        }

        throw error; // 让 BullMQ 处理重试
      }
    },
    {
      connection,
      concurrency,
      limiter: {
        max: concurrency,
        duration: 1000,
      },
    }
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'Job 最终失败');
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job 完成');
  });

  return worker;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 检查任务是否全部完成
 * 如果所有用例都已执行完（无 pending/running），则：
 * 1. 计算综合评分
 * 2. 更新任务状态为 done
 * 3. 生成最终总结和改进建议，插入到报告头部
 */
async function checkTaskCompletion(taskId: string) {
  const taskLogger = createTaskLogger(taskId);

  // 原子检测：只有当所有用例都完成且任务状态仍为 running 时才标记完成
  // 用原子 UPDATE 避免多个 Worker 并发触发完成逻辑
  const updateResult = await db.run(
    sql`UPDATE tasks SET status = 'completing' WHERE id = ${taskId} AND status = 'running' AND (SELECT count(*) FROM cases WHERE task_id = ${taskId} AND status IN ('pending', 'running')) = 0`
  );

  // 如果没有更新成功，说明要么还有未完成的用例，要么已经被其他 Worker 处理了
  if ((updateResult as any).changes === 0) {
    return;
  }

  taskLogger.info('所有用例执行完成，开始生成最终报告');

  // 获取任务信息
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });
  if (!task) return;

  // 获取所有判分结果
  const verdicts = await db.select().from(schema.verdicts)
    .where(eq(schema.verdicts.taskId, taskId));
  const cases = await db.select().from(schema.cases)
    .where(eq(schema.cases.taskId, taskId));

  // 计算评分
  const passedCases = verdicts.filter(v => v.pass === 1).length;
  const failedCases = verdicts.filter(v => v.pass === 0).length;
  const totalWeight = cases.reduce((sum, c) => sum + c.weight, 0);
  const weightedScore = verdicts.reduce((sum, v) => {
    const c = cases.find(c => c.id === v.caseId);
    return sum + v.score * (c?.weight || 3);
  }, 0);
  const overallScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;

  // 生成最终总结（含改进建议）
  const config: TaskConfig = JSON.parse(task.configJson);
  const testCases: TestCase[] = cases.map(c => ({
    id: c.id,
    taskId: c.taskId,
    dimension: c.dimension as any,
    subType: c.subType,
    turns: JSON.parse(c.turnsJson),
    expectation: c.expectation,
    passCriteria: JSON.parse(c.passCriteriaJson),
    weight: c.weight,
    evaluationStrategy: c.evaluationStrategy as any,
    status: c.status as any,
    orderIndex: c.orderIndex,
  }));
  const verdictList: Verdict[] = verdicts.map(v => ({
    caseId: v.caseId,
    pass: v.pass === 1,
    score: v.score,
    reason: v.reason,
    confidence: v.confidence,
    severity: v.severity as any,
    suggestion: v.suggestion || undefined,
    evidence: v.evidence || '',
    strategyUsed: v.strategyUsed as any,
    dualJudge: v.dualJudgeJson ? JSON.parse(v.dualJudgeJson) : { judge1: {}, judge2: {}, consensus: true },
    hallucinationCheck: v.hallucinationJson ? JSON.parse(v.hallucinationJson) : { detected: false },
    needsHumanReview: v.needsHumanReview === 1,
  }));

  // 生成最终报告（带重试）
  let finalSummary: string | null = null;
  for (let retry = 0; retry <= 1; retry++) {
    try {
      finalSummary = await generateFinalSummary(
        config,
        task.agentName || `${task.platform}-${task.botId.slice(-6)}`,
        testCases,
        verdictList,
        task.startedAt || task.createdAt,
        Date.now()
      );
      break;
    } catch (error: any) {
      taskLogger.warn({ error: error.message, retry }, '最终报告生成失败');
      if (retry === 0) await sleep(5000); // 重试前等 5 秒
    }
  }

  const existingContent = task.reportContent || '';

  if (finalSummary) {
    // 将总结插入到报告头部
    const fullReport = finalSummary + '\n---\n\n## 测试用例详细结果\n\n' + existingContent;

    await db.update(schema.tasks).set({
      status: 'done',
      finishedAt: Date.now(),
      overallScore,
      passedCases,
      failedCases: failedCases,
      reportContent: fullReport,
      improvementReport: null,
    }).where(eq(schema.tasks.id, taskId));

    taskLogger.info({ overallScore, passedCases, failedCases }, '任务完成，报告已生成');
  } else {
    // 报告生成彻底失败，用纯统计数据生成简单报告头
    const passRate = testCases.length > 0 ? Math.round((passedCases / testCases.length) * 100) : 0;
    const simpleSummary = `# 智能体测试报告\n\n## 测试概况\n\n- 综合评分：${overallScore}/100\n- 通过率：${passRate}%（${passedCases}/${testCases.length}）\n- 失败用例：${failedCases} 条\n\n> 注：改进建议生成失败，请查看下方用例详情。\n\n---\n\n## 测试用例详细结果\n\n`;

    await db.update(schema.tasks).set({
      status: 'done',
      finishedAt: Date.now(),
      overallScore,
      passedCases,
      failedCases,
      reportContent: simpleSummary + existingContent,
    }).where(eq(schema.tasks.id, taskId));

    taskLogger.warn({ overallScore, passedCases, failedCases }, '任务完成，但报告使用简化版本');
  }
}
