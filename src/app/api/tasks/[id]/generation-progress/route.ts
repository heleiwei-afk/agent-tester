import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

const DIMENSION_NAMES: Record<string, string> = {
  alignment: '预期效果',
  industry: '行业规范',
  boundary: '边界兜底',
  badcase: 'Bad Case',
  security: '安全性',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  const progress = await db.select().from(schema.generationProgress)
    .where(eq(schema.generationProgress.taskId, taskId));

  if (progress.length === 0) {
    return NextResponse.json({ progress: [], summary: null });
  }

  const progressWithNames = progress.map(p => ({
    ...p,
    dimensionName: DIMENSION_NAMES[p.dimension] || p.dimension,
    errorMessages: p.errorMessages ? JSON.parse(p.errorMessages) : [],
  }));

  // 按维度顺序排序
  const dimOrder = ['alignment', 'industry', 'boundary', 'badcase', 'security'];
  progressWithNames.sort((a, b) => dimOrder.indexOf(a.dimension) - dimOrder.indexOf(b.dimension));

  const summary = {
    totalTarget: progress.reduce((sum, p) => sum + p.targetCount, 0),
    totalGenerated: progress.reduce((sum, p) => sum + (p.generatedCount || 0), 0),
    totalAfterDedup: progress.reduce((sum, p) => sum + (p.afterDedupCount || 0), 0),
    totalAfterReview: progress.reduce((sum, p) => sum + (p.afterReviewCount || 0), 0),
    dimensionsDone: progress.filter(p => p.status === 'done').length,
    dimensionsFailed: progress.filter(p => p.status === 'failed').length,
    dimensionsTotal: progress.length,
  };

  return NextResponse.json({ progress: progressWithNames, summary });
}
