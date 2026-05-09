import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { initDatabase } from '@/lib/db/migrate';
import { TaskConfigSchema } from '@/lib/types';
import { v4 as uuid } from 'uuid';
import { desc, eq, sql } from 'drizzle-orm';
import { generationQueue } from '@/lib/queue';

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
      status: 'pending',
      totalCases: config.caseCount,
      createdAt: now,
    });

    // 入队：触发用例生成
    await generationQueue.add('generate', {
      taskId,
      config,
    }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 3000 },
    });

    // 更新状态为 generating
    await db.update(schema.tasks)
      .set({ status: 'generating' })
      .where(eq(schema.tasks.id, taskId));

    return NextResponse.json({
      id: taskId,
      status: 'generating',
      message: '任务已创建，正在生成测试用例...',
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
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const offset = (page - 1) * pageSize;

  try {
    let query = db.select().from(schema.tasks);

    if (status) {
      // 支持分组筛选
      if (status === 'running') {
        query = query.where(
          sql`${schema.tasks.status} IN ('generating', 'running')`
        ) as any;
      } else if (status === 'waiting') {
        query = query.where(
          sql`${schema.tasks.status} IN ('pending', 'reviewing')`
        ) as any;
      } else if (status === 'completed') {
        query = query.where(
          sql`${schema.tasks.status} IN ('done', 'cancelled', 'failed')`
        ) as any;
      } else {
        query = query.where(eq(schema.tasks.status, status)) as any;
      }
    }

    const tasks = await (query as any)
      .orderBy(desc(schema.tasks.createdAt))
      .limit(pageSize)
      .offset(offset);

    // 获取总数
    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(schema.tasks);
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
