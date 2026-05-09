import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateImprovementReport } from '@/lib/report';
import type { ImprovementReport } from '@/lib/types';

/**
 * GET /api/tasks/[id]/improvement — 获取改进报告
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
      return NextResponse.json({ code: 'NOT_FOUND', message: '任务不存在' }, { status: 404 });
    }

    // 如果已有缓存的改进报告，直接返回
    if (task.improvementReport) {
      const report: ImprovementReport = JSON.parse(task.improvementReport);
      return NextResponse.json({ report });
    }

    // 如果 reportContent 中已包含改进建议（新逻辑），提取返回
    if (task.reportContent && task.reportContent.includes('## 整体改进建议')) {
      return NextResponse.json({
        report: {
          summary: {
            overallAssessment: '改进建议已包含在测试报告中，请查看报告详情页。',
            keyIssues: [],
            priorityOrder: [],
          },
          details: [],
        },
        embeddedInReport: true,
      });
    }

    // 否则生成改进报告（限制输入量：最多 top 20 条高严重度失败用例）
    const cases = await db.select().from(schema.cases)
      .where(eq(schema.cases.taskId, id));
    const verdicts = await db.select().from(schema.verdicts)
      .where(eq(schema.verdicts.taskId, id));
    const results = await db.select().from(schema.results)
      .where(eq(schema.results.taskId, id));

    const responses = new Map<string, string>();
    for (const r of results) {
      if (r.responseContent) {
        responses.set(r.caseId, r.responseContent);
      }
    }

    const config = JSON.parse(task.configJson);

    const reportData = {
      taskId: id,
      config,
      agentName: task.agentName || '',
      cases: cases.map(c => ({
        id: c.id,
        taskId: c.taskId,
        dimension: c.dimension as any,
        subType: c.subType,
        turns: JSON.parse(c.turnsJson),
        expectation: c.expectation,
        passCriteria: JSON.parse(c.passCriteriaJson),
        weight: c.weight,
        evaluationStrategy: c.evaluationStrategy as any,
        status: c.status as any,
        orderIndex: c.orderIndex,
      })),
      verdicts: verdicts.map(v => ({
        caseId: v.caseId,
        pass: v.pass === 1,
        score: v.score,
        reason: v.reason,
        confidence: v.confidence,
        severity: v.severity as any,
        suggestion: v.suggestion || undefined,
        evidence: v.evidence || '',
        strategyUsed: v.strategyUsed as any,
        dualJudge: v.dualJudgeJson ? JSON.parse(v.dualJudgeJson) : { judge1: {}, judge2: {}, consensus: true },
        hallucinationCheck: v.hallucinationJson ? JSON.parse(v.hallucinationJson) : { detected: false },
        needsHumanReview: v.needsHumanReview === 1,
      })),
      responses,
      startedAt: task.startedAt || task.createdAt,
      finishedAt: task.finishedAt || Date.now(),
    };

    const report = await generateImprovementReport(reportData);

    // 缓存到数据库
    await db.update(schema.tasks)
      .set({ improvementReport: JSON.stringify(report) })
      .where(eq(schema.tasks.id, id));

    return NextResponse.json({ report });

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '生成改进报告失败',
      details: error.message,
    }, { status: 500 });
  }
}
