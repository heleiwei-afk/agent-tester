import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, desc, sql } from 'drizzle-orm';

/**
 * GET /api/tasks/[id]/cases — 获取任务的所有测试用例
 * 支持筛选：dimension, status, severity
 * 支持排序：severity_desc（默认）, order_index
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const dimension = searchParams.get('dimension');
  const status = searchParams.get('status');
  const sortBy = searchParams.get('sort') || 'order_index';

  try {
    // 获取用例列表
    let conditions = [eq(schema.cases.taskId, id)];

    const casesQuery = db.select().from(schema.cases)
      .where(eq(schema.cases.taskId, id))
      .orderBy(schema.cases.orderIndex);

    const cases = await casesQuery;

    // 获取对应的判分结果
    const verdicts = await db.select().from(schema.verdicts)
      .where(eq(schema.verdicts.taskId, id));

    // 获取对应的执行结果
    const results = await db.select().from(schema.results)
      .where(eq(schema.results.taskId, id));

    // 组装完整数据
    let caseDetails = cases.map(c => {
      const verdict = verdicts.find(v => v.caseId === c.id);
      const result = results.find(r => r.caseId === c.id);

      return {
        ...c,
        turns: JSON.parse(c.turnsJson),
        passCriteria: JSON.parse(c.passCriteriaJson),
        verdict: verdict ? {
          pass: verdict.pass === 1,
          score: verdict.score,
          reason: verdict.reason,
          confidence: verdict.confidence,
          severity: verdict.severity,
          suggestion: verdict.suggestion,
          evidence: verdict.evidence,
          needsHumanReview: verdict.needsHumanReview === 1,
          dualJudge: verdict.dualJudgeJson ? JSON.parse(verdict.dualJudgeJson) : null,
          hallucinationCheck: verdict.hallucinationJson ? JSON.parse(verdict.hallucinationJson) : null,
        } : null,
        result: result ? {
          responseContent: result.responseContent,
          latencyMs: result.latencyMs,
          errorType: result.errorType,
          errorMsg: result.errorMsg,
        } : null,
      };
    });

    // 应用筛选
    if (dimension) {
      caseDetails = caseDetails.filter(c => c.dimension === dimension);
    }
    if (status) {
      if (status === 'pass') {
        caseDetails = caseDetails.filter(c => c.verdict?.pass === true);
      } else if (status === 'fail') {
        caseDetails = caseDetails.filter(c => c.verdict?.pass === false);
      } else {
        caseDetails = caseDetails.filter(c => c.status === status);
      }
    }

    // 应用排序
    if (sortBy === 'severity_desc') {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      caseDetails.sort((a, b) => {
        const sa = (a.verdict?.severity as keyof typeof severityOrder) || 'low';
        const sb = (b.verdict?.severity as keyof typeof severityOrder) || 'low';
        return (severityOrder[sa] ?? 4) - (severityOrder[sb] ?? 4);
      });
    }

    // 统计信息
    const stats = {
      total: cases.length,
      pending: cases.filter(c => c.status === 'pending').length,
      running: cases.filter(c => c.status === 'running').length,
      done: cases.filter(c => c.status === 'done').length,
      failed: cases.filter(c => c.status === 'failed' || c.status === 'timeout').length,
      passed: verdicts.filter(v => v.pass === 1).length,
      verdictFailed: verdicts.filter(v => v.pass === 0).length,
    };

    return NextResponse.json({ cases: caseDetails, stats });

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '获取用例列表失败',
      details: error.message,
    }, { status: 500 });
  }
}
