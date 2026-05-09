import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { executionQueue } from '@/lib/queue';
import type { TaskConfig } from '@/lib/types';

/**
 * POST /api/tasks/[id]/execute — 用户确认用例后开始执行
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, id),
    });

    if (!task) {
      return NextResponse.json({ code: 'NOT_FOUND', message: '任务不存在' }, { status: 404 });
    }

    if (task.status !== 'reviewing') {
      return NextResponse.json({
        code: 'INVALID_STATE',
        message: `当前状态为 ${task.status}，只有 reviewing 状态可以开始执行`,
      }, { status: 400 });
    }

    const config: TaskConfig = JSON.parse(task.configJson);

    // 获取所有 pending 用例
    const cases = await db.select().from(schema.cases)
      .where(eq(schema.cases.taskId, id));

    const pendingCases = cases.filter(c => c.status === 'pending');

    if (pendingCases.length === 0) {
      return NextResponse.json({
        code: 'NO_CASES',
        message: '没有待执行的用例',
      }, { status: 400 });
    }

    // 批量入队
    await executionQueue.addBulk(
      pendingCases.map((c) => ({
        name: 'run-case',
        data: {
          caseId: c.id,
          taskId: id,
          platform: config.platform,
          apiKey: config.apiKey,
          botId: config.botId,
          turns: JSON.parse(c.turnsJson),
          timeoutSec: config.timeoutSec,
          retryCount: config.retryCount,
        },
        opts: {
          attempts: config.retryCount + 1,
          backoff: { type: 'exponential' as const, delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: false,
          priority: c.weight,
        },
      }))
    );

    // 更新任务状态
    await db.update(schema.tasks)
      .set({ status: 'running', startedAt: Date.now() })
      .where(eq(schema.tasks.id, id));

    return NextResponse.json({
      message: '开始执行',
      totalCases: pendingCases.length,
    });

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '启动执行失败',
      details: error.message,
    }, { status: 500 });
  }
}
