import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';
import { executionQueue, generationQueue, evaluationQueue } from '@/lib/queue';

/**
 * GET /api/tasks/[id] — 任务详情
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, id),
    });

    if (!task) {
      return NextResponse.json({
        code: 'NOT_FOUND',
        message: '任务不存在',
      }, { status: 404 });
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

    return NextResponse.json({
      task,
      caseStats: caseStats[0] || { total: 0, pending: 0, running: 0, done: 0, failed: 0 },
      verdictStats: verdictStats[0] || { total: 0, passed: 0, failed: 0, avgScore: 0 },
    });

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '获取任务详情失败',
      details: error.message,
    }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id] — 取消或删除任务
 * ?permanent=true 时彻底删除（级联删除所有关联数据）
 * 否则仅标记为 cancelled
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const permanent = searchParams.get('permanent') === 'true';

  try {
    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, id),
    });

    if (!task) {
      return NextResponse.json({
        code: 'NOT_FOUND',
        message: '任务不存在',
      }, { status: 404 });
    }

    if (permanent) {
      // 1. 从 BullMQ 队列中移除该任务的所有 Job
      const queues = [executionQueue, generationQueue, evaluationQueue];
      for (const queue of queues) {
        try {
          const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized', 'paused']);
          for (const job of jobs) {
            if (job.data?.taskId === id) {
              await job.remove().catch(() => {});
            }
          }
        } catch {}
      }

      // 2. 级联删除数据库数据
      await db.delete(schema.verdicts).where(eq(schema.verdicts.taskId, id));
      await db.delete(schema.results).where(eq(schema.results.taskId, id));
      await db.delete(schema.cases).where(eq(schema.cases.taskId, id));
      await db.delete(schema.generationProgress).where(eq(schema.generationProgress.taskId, id));
      await db.delete(schema.testOutlines).where(eq(schema.testOutlines.taskId, id));
      await db.delete(schema.tasks).where(eq(schema.tasks.id, id));
      return NextResponse.json({ message: '任务已彻底删除' });
    } else {
      // 软取消：标记状态
      await db.update(schema.tasks)
        .set({ status: 'cancelled', finishedAt: Date.now() })
        .where(eq(schema.tasks.id, id));

      await db.update(schema.cases)
        .set({ status: 'failed' })
        .where(sql`${schema.cases.taskId} = ${id} AND ${schema.cases.status} IN ('pending', 'running')`);

      return NextResponse.json({ message: '任务已取消' });
    }

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '删除任务失败',
      details: error.message,
    }, { status: 500 });
  }
}
