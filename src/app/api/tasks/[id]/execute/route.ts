import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { executionQueue } from '@/lib/queue';
import type { TaskConfig } from '@/lib/types';

/**
 * POST /api/tasks/[id]/execute — 用户确认用例后开始执行
 * 
 * 改为入队单个串行 Job：同一任务的所有用例共享会话，按顺序执行。
 * 遇到 new_session=1 的用例时重建会话。
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

    // 获取所有 pending 用例（按 orderIndex 排序）
    const cases = await db.select().from(schema.cases)
      .where(eq(schema.cases.taskId, id));

    const pendingCases = cases
      .filter(c => c.status === 'pending')
      .sort((a, b) => a.orderIndex - b.orderIndex);

    if (pendingCases.length === 0) {
      return NextResponse.json({
        code: 'NO_CASES',
        message: '没有待执行的用例',
      }, { status: 400 });
    }

    // 入队单个串行 Job（包含所有用例 ID）
    await executionQueue.add('run-task-serial', {
      taskId: id,
      caseIds: pendingCases.map(c => c.id),
      platform: config.platform,
      apiKey: config.apiKey,
      botId: config.botId,
      testContext: config.testContext || null,
      timeoutSec: config.timeoutSec,
      retryCount: config.retryCount,
    }, {
      attempts: 1, // 整个任务不重试（单条用例内部有重试）
      removeOnComplete: 50,
      removeOnFail: false,
    });

    // 更新任务状态
    await db.update(schema.tasks)
      .set({ status: 'running', startedAt: Date.now() })
      .where(eq(schema.tasks.id, id));

    return NextResponse.json({
      message: '开始执行（串行模式，共享会话）',
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
