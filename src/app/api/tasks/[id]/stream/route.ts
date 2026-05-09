import { NextRequest } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

/**
 * GET /api/tasks/[id]/stream — SSE 实时进度推送
 * 
 * 每 1 秒推送一次任务进度，包含：
 * - 用例执行状态统计
 * - 最新完成的用例信息
 * - 任务整体状态
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // 心跳 + 进度推送循环
      const interval = setInterval(async () => {
        if (closed) {
          clearInterval(interval);
          return;
        }

        try {
          // 获取任务状态
          const task = await db.query.tasks.findFirst({
            where: eq(schema.tasks.id, id),
          });

          if (!task) {
            sendEvent('error', { message: '任务不存在' });
            closed = true;
            clearInterval(interval);
            controller.close();
            return;
          }

          // 获取用例统计
          const caseStats = await db.select({
            total: sql<number>`count(*)`,
            pending: sql<number>`sum(case when status = 'pending' then 1 else 0 end)`,
            running: sql<number>`sum(case when status = 'running' then 1 else 0 end)`,
            done: sql<number>`sum(case when status = 'done' then 1 else 0 end)`,
            failed: sql<number>`sum(case when status IN ('failed', 'timeout') then 1 else 0 end)`,
          }).from(schema.cases).where(eq(schema.cases.taskId, id));

          // 获取判分统计
          const verdictStats = await db.select({
            total: sql<number>`count(*)`,
            passed: sql<number>`sum(case when pass = 1 then 1 else 0 end)`,
            failed: sql<number>`sum(case when pass = 0 then 1 else 0 end)`,
            avgScore: sql<number>`avg(score)`,
          }).from(schema.verdicts).where(eq(schema.verdicts.taskId, id));

          // 获取最近完成的用例（最新 3 条）
          const recentResults = await db.select({
            caseId: schema.cases.id,
            dimension: schema.cases.dimension,
            subType: schema.cases.subType,
            status: schema.cases.status,
            latencyMs: schema.results.latencyMs,
          })
            .from(schema.cases)
            .leftJoin(schema.results, eq(schema.cases.id, schema.results.caseId))
            .where(sql`${schema.cases.taskId} = ${id} AND ${schema.cases.status} IN ('done', 'failed', 'timeout')`)
            .orderBy(sql`${schema.results.createdAt} DESC`)
            .limit(3);

          // 推送进度事件
          sendEvent('progress', {
            taskStatus: task.status,
            caseStats: caseStats[0] || {},
            verdictStats: verdictStats[0] || {},
            recentResults,
            timestamp: Date.now(),
          });

          // 如果任务已完成，发送完成事件并关闭
          if (['done', 'cancelled', 'failed'].includes(task.status)) {
            sendEvent('complete', {
              status: task.status,
              overallScore: task.overallScore,
              passedCases: task.passedCases,
              totalCases: task.totalCases,
            });
            closed = true;
            clearInterval(interval);
            controller.close();
          }
        } catch (error) {
          // 数据库查询失败不中断连接，等下次重试
        }
      }, 1000);

      // 30 秒心跳
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        sendEvent('heartbeat', { timestamp: Date.now() });
      }, 30000);

      // 客户端断开时清理
      request.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // 防止 nginx 缓冲
    },
  });
}
