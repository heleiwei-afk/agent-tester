import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';
import { executionQueue } from '@/lib/queue';
import { v4 as uuid } from 'uuid';

/**
 * POST /api/tasks/[id]/cases — 任务控制操作
 * 
 * body.action: 'pause' | 'resume' | 'retry_case'
 * body.caseId: string (retry_case 时必填)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { action, caseId } = body;

  try {
    switch (action) {
      case 'pause': {
        await executionQueue.pause();
        await db.update(schema.tasks)
          .set({ status: 'pending' }) // 暂停状态用 pending 表示
          .where(eq(schema.tasks.id, id));
        return NextResponse.json({ message: '任务已暂停，当前执行中的用例会跑完' });
      }

      case 'resume': {
        await executionQueue.resume();
        await db.update(schema.tasks)
          .set({ status: 'running' })
          .where(eq(schema.tasks.id, id));
        return NextResponse.json({ message: '任务已恢复' });
      }

      case 'retry_case': {
        if (!caseId) {
          return NextResponse.json({ code: 'MISSING_CASE_ID', message: '缺少 caseId' }, { status: 400 });
        }

        const caseRow = await db.query.cases.findFirst({
          where: eq(schema.cases.id, caseId),
        });

        if (!caseRow || caseRow.taskId !== id) {
          return NextResponse.json({ code: 'NOT_FOUND', message: '用例不存在' }, { status: 404 });
        }

        const task = await db.query.tasks.findFirst({
          where: eq(schema.tasks.id, id),
        });

        if (!task) {
          return NextResponse.json({ code: 'NOT_FOUND', message: '任务不存在' }, { status: 404 });
        }

        const config = JSON.parse(task.configJson);

        // 重置用例状态
        await db.update(schema.cases)
          .set({ status: 'pending' })
          .where(eq(schema.cases.id, caseId));

        // 删除旧的结果和判分
        await db.delete(schema.results).where(eq(schema.results.caseId, caseId));
        await db.delete(schema.verdicts).where(eq(schema.verdicts.caseId, caseId));

        // 重新入队
        await executionQueue.add('run-case', {
          caseId,
          taskId: id,
          platform: config.platform,
          apiKey: config.apiKey,
          botId: config.botId,
          turns: JSON.parse(caseRow.turnsJson),
          timeoutSec: config.timeoutSec,
          retryCount: config.retryCount,
        }, {
          attempts: config.retryCount + 1,
          backoff: { type: 'exponential' as const, delay: 2000 },
          priority: caseRow.weight,
        });

        return NextResponse.json({ message: '用例已重新入队' });
      }

      default:
        return NextResponse.json({ code: 'INVALID_ACTION', message: `不支持的操作: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '操作失败',
      details: error.message,
    }, { status: 500 });
  }
}
