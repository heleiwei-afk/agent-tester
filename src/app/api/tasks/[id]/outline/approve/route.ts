import { NextRequest, NextResponse } from 'next/server';
import { approveTestOutline } from '@/lib/generator/outline';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generationQueue } from '@/lib/queue';

/**
 * POST /api/tasks/[id]/outline/approve
 * 批准大纲并触发用例生成
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    // 检查任务是否存在
    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
    if (tasks.length === 0) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    const task = tasks[0];
    const config = JSON.parse(task.configJson);

    // 批准大纲
    await approveTestOutline(taskId);

    // 更新任务状态为 generating
    await db
      .update(schema.tasks)
      .set({ status: 'generating' })
      .where(eq(schema.tasks.id, taskId));

    // 入队用例生成 Job
    await generationQueue.add('generate-cases-from-outline', {
      taskId,
      config,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('批准大纲失败:', error);
    return NextResponse.json(
      { error: '批准大纲失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
