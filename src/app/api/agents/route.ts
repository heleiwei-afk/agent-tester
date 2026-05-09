import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, desc, sql } from 'drizzle-orm';

/**
 * GET /api/agents — 智能体列表（从 tasks 表聚合）
 * 每次测试独立一行
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const platform = searchParams.get('platform');
  const offset = (page - 1) * pageSize;

  try {
    // 查询已完成的任务（作为智能体测试记录）
    let query = db.select().from(schema.tasks)
      .where(sql`${schema.tasks.status} IN ('done', 'failed', 'cancelled')`)
      .orderBy(desc(schema.tasks.finishedAt));

    if (platform) {
      query = db.select().from(schema.tasks)
        .where(sql`${schema.tasks.status} IN ('done', 'failed', 'cancelled') AND ${schema.tasks.platform} = ${platform}`)
        .orderBy(desc(schema.tasks.finishedAt)) as any;
    }

    const tasks = await (query as any).limit(pageSize).offset(offset);

    // 获取总数
    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(schema.tasks)
      .where(sql`${schema.tasks.status} IN ('done', 'failed', 'cancelled')`);
    const total = countResult[0]?.count || 0;

    // 组装智能体列表数据
    const agents = tasks.map((task: any) => ({
      id: task.id,
      agentName: task.agentName || `${getPlatformPrefix(task.platform)}-${task.botId.slice(-6)}`,
      platform: task.platform,
      botId: task.botId,
      testTime: task.finishedAt,
      casesLink: `/tasks/${task.id}/cases`,
      passRate: task.totalCases && task.passedCases !== null
        ? `${task.passedCases}/${task.totalCases}`
        : '-',
      overallScore: task.overallScore ?? '-',
      status: task.status,
      hasReport: task.status === 'done',
      hasImprovementReport: !!task.improvementReport,
    }));

    return NextResponse.json({
      agents,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '获取智能体列表失败',
      details: error.message,
    }, { status: 500 });
  }
}

function getPlatformPrefix(platform: string): string {
  switch (platform) {
    case 'bailian': return '百炼';
    case 'coze_cn': return 'Coze国内';
    case 'coze_global': return 'Coze国际';
    default: return platform;
  }
}
