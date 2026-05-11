import { NextRequest, NextResponse } from 'next/server';
import { getTestOutline, updateTestOutline, approveTestOutline } from '@/lib/generator/outline';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

/**
 * GET /api/tasks/[id]/outline
 * 获取任务的测试大纲
 */
export async function GET(
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

    // 获取大纲
    const outline = await getTestOutline(taskId);
    if (!outline) {
      return NextResponse.json({ error: '大纲不存在' }, { status: 404 });
    }

    return NextResponse.json({ outline });
  } catch (error) {
    console.error('获取大纲失败:', error);
    return NextResponse.json(
      { error: '获取大纲失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/tasks/[id]/outline
 * 更新任务的测试大纲
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const { outline } = body;

    if (!outline) {
      return NextResponse.json({ error: '缺少 outline 参数' }, { status: 400 });
    }

    // 更新大纲
    await updateTestOutline(taskId, outline);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('更新大纲失败:', error);
    return NextResponse.json(
      { error: '更新大纲失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
