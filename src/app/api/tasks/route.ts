import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { initDatabase } from '@/lib/db/migrate';
import { TaskConfigSchema } from '@/lib/types';
import { v4 as uuid } from 'uuid';
import { desc, eq, sql } from 'drizzle-orm';
import { addGenerationJob } from '@/lib/queue';

// 确保数据库初始化
let dbInitialized = false;
function ensureDB() {
  if (!dbInitialized) {
    initDatabase();
    dbInitialized = true;
  }
}

/**
 * POST /api/tasks — 创建测试任务
 */
export async function POST(request: NextRequest) {
  ensureDB();

  try {
    const body = await request.json();
    // trim 所有字符串字段，防止前端输入时带空格
    if (body.apiKey) body.apiKey = body.apiKey.trim();
    if (body.botId) body.botId = body.botId.trim();
    const config = TaskConfigSchema.parse(body);

    const taskId = uuid();
    const now = Date.now();

    // 写入数据库（如果用户填了名称直接用）
    await db.insert(schema.tasks).values({
      id: taskId,
      agentName: config.agentName || null, // 用户填了就用，没填稍后自动获取
      botId: config.botId,
      platform: config.platform,
      configJson: JSON.stringify(config),
      status: 'analyzing',
      totalCases: config.caseCount,
      createdAt: now,
    });

    // 入队：触发大纲生成
    await addGenerationJob(taskId, config);

    return NextResponse.json({
      id: taskId,
      status: 'analyzing',
      message: '任务已创建，正在分析智能体并生成测试大纲...',
    }, { status: 201 });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return NextResponse.json({
        code: 'VALIDATION_ERROR',
        message: '参数校验失败',
        details: error.errors,
      }, { status: 400 });
    }

    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '创建任务失败',
      details: error.message,
    }, { status: 500 });
  }
}

/**
 * GET /api/tasks — 任务列表（支持状态筛选和分页）
 */
export async function GET(request: NextRequest) {
  ensureDB();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '30');
  const offset = (page - 1) * pageSize;

  try {
    // 构建 status 筛选条件（复用于 query 和 count）
    let statusCondition: any = undefined;
    if (status) {
      if (status === 'running') {
        statusCondition = sql`${schema.tasks.status} IN ('analyzing', 'outline_review', 'generating', 'running', 'completing')`;
      } else if (status === 'waiting') {
        statusCondition = sql`${schema.tasks.status} IN ('pending', 'reviewing')`;
      } else if (status === 'completed') {
        statusCondition = sql`${schema.tasks.status} IN ('done', 'cancelled', 'failed')`;
      } else {
        statusCondition = eq(schema.tasks.status, status);
      }
    }

    // 查询任务列表
    let query = db.select().from(schema.tasks);
    if (statusCondition) {
      query = query.where(statusCondition) as any;
    }
    const tasks = await (query as any)
      .orderBy(desc(schema.tasks.createdAt))
      .limit(pageSize)
      .offset(offset);

    // 获取总数（应用相同的 status 筛选）
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(schema.tasks);
    if (statusCondition) {
      countQuery = countQuery.where(statusCondition) as any;
    }
    const countResult = await countQuery;
    const total = countResult[0]?.count || 0;

    return NextResponse.json({
      tasks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '获取任务列表失败',
      details: error.message,
    }, { status: 500 });
  }
}
