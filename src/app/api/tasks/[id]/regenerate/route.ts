import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and, inArray } from 'drizzle-orm';
import { addGenerationJob } from '@/lib/queue';
import type { Dimension, TaskConfig } from '@/lib/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const body = await request.json();
  const { dimensions } = body as { dimensions: Dimension[] };

  if (!dimensions || dimensions.length === 0) {
    return NextResponse.json({ error: '请指定要重新生成的维度' }, { status: 400 });
  }

  // 校验任务状态
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });

  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  if (task.status !== 'generating' && task.status !== 'reviewing') {
    return NextResponse.json(
      { error: `当前状态 "${task.status}" 不允许重新生成，仅 generating/reviewing 状态可操作` },
      { status: 400 }
    );
  }

  // 删除指定维度的旧用例
  const oldCases = await db.select({ id: schema.cases.id }).from(schema.cases)
    .where(and(
      eq(schema.cases.taskId, taskId),
      inArray(schema.cases.dimension, dimensions)
    ));

  if (oldCases.length > 0) {
    const caseIds = oldCases.map(c => c.id);
    // 删除关联的 results 和 verdicts
    for (const caseId of caseIds) {
      await db.delete(schema.results).where(eq(schema.results.caseId, caseId));
      await db.delete(schema.verdicts).where(eq(schema.verdicts.caseId, caseId));
    }
    // 删除用例
    await db.delete(schema.cases).where(and(
      eq(schema.cases.taskId, taskId),
      inArray(schema.cases.dimension, dimensions)
    ));
  }

  // 重置 generation_progress 中指定维度的状态
  for (const dim of dimensions) {
    await db.update(schema.generationProgress)
      .set({
        status: 'pending',
        generatedCount: 0,
        afterDedupCount: 0,
        afterReviewCount: 0,
        batchTotal: 0,
        batchSuccess: 0,
        batchFailed: 0,
        errorMessages: '[]',
        startedAt: null,
        finishedAt: null,
      })
      .where(and(
        eq(schema.generationProgress.taskId, taskId),
        eq(schema.generationProgress.dimension, dim)
      ));
  }

  // 更新任务状态为 generating
  await db.update(schema.tasks)
    .set({ status: 'generating' })
    .where(eq(schema.tasks.id, taskId));

  // 获取配置并入队生成 Job
  const config: TaskConfig = JSON.parse(task.configJson);

  await addGenerationJob(taskId, config, dimensions);

  return NextResponse.json({
    success: true,
    message: `已提交重新生成：${dimensions.join(', ')}`,
    deletedCases: oldCases.length,
  });
}
