import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generationQueue } from '@/lib/queue';

/**
 * POST /api/tasks/[id]/outline/generate
 * 重新生成测试大纲
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

    // 删除旧大纲
    await db
      .delete(schema.testOutlines)
      .where(eq(schema.testOutlines.taskId, taskId));

    // 更新任务状态为 analyzing
    await db
      .update(schema.tasks)
      .set({ status: 'analyzing' })
      .where(eq(schema.tasks.id, taskId));

    // 入队大纲生成 Job
    await generationQueue.add('generate-outline', {
      taskId,
      config,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('重新生成大纲失败:', error);
    return NextResponse.json(
      { error: '重新生成大纲失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
