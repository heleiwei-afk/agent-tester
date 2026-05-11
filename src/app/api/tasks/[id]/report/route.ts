import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateMarkdownReport, generateImprovementReport } from '@/lib/report';
import type { TestCase, Verdict } from '@/lib/types';

/**
 * GET /api/tasks/[id]/report — 下载测试报告
 * ?format=md (默认)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'md';

  try {
    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, id),
    });

    if (!task) {
      return NextResponse.json({ code: 'NOT_FOUND', message: '任务不存在' }, { status: 404 });
    }

    // 获取用例和判分
    const cases = await db.select().from(schema.cases)
      .where(eq(schema.cases.taskId, id));
    const verdicts = await db.select().from(schema.verdicts)
      .where(eq(schema.verdicts.taskId, id));
    const results = await db.select().from(schema.results)
      .where(eq(schema.results.taskId, id));

    // 构建响应映射
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
      agentName: task.agentName || `${task.platform}-${task.botId.slice(-6)}`,
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
        newSession: c.newSession === 1,
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

    if (format === 'md') {
      // 优先使用实时累积的报告内容
      if (task.reportContent) {
        return new NextResponse(task.reportContent, {
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="report-${id}.md"`,
          },
        });
      }
      // 降级：用旧逻辑生成
      const markdown = generateMarkdownReport(reportData);
      return new NextResponse(markdown, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="report-${id}.md"`,
        },
      });
    }

    if (format === 'pdf') {
      const { generatePDFReport } = await import('@/lib/report/pdf');
      const pdf = await generatePDFReport(reportData);
      if (pdf) {
        return new NextResponse(new Uint8Array(pdf), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="report-${id}.pdf"`,
          },
        });
      }
      // PDF 生成失败，降级到 Markdown
      const markdown = task.reportContent || generateMarkdownReport(reportData);
      return new NextResponse(markdown, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="report-${id}.md"`,
        },
      });
    }

    if (format === 'json') {
      // 修复 Map 序列化问题：转为普通对象
      const responsesObj: Record<string, string> = {};
      for (const r of results) {
        if (r.responseContent) {
          responsesObj[r.caseId] = r.responseContent;
        }
      }
      return NextResponse.json({ ...reportData, responses: responsesObj });
    }

    return NextResponse.json({ code: 'INVALID_FORMAT', message: '不支持的格式，支持 md/pdf/json' }, { status: 400 });

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '生成报告失败',
      details: error.message,
    }, { status: 500 });
  }
}
