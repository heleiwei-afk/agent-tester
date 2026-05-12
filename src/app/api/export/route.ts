import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { v4 as uuid } from 'uuid';
import { processExportJob } from '@/lib/export/worker';

/**
 * POST /api/export — 创建异步导出任务
 * Body: { taskIds: string[] }
 * Response: { jobId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { taskIds } = await request.json();

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json({ code: 'INVALID_INPUT', message: '请选择至少一个任务' }, { status: 400 });
    }

    const jobId = uuid();
    const now = Date.now();
    const isSingle = taskIds.length === 1;
    const fileName = isSingle
      ? `report-${taskIds[0].slice(0, 8)}.pdf`
      : `批量导出_${new Date().toISOString().slice(0, 10)}.zip`;

    // 创建导出任务记录
    await db.insert(schema.exportJobs).values({
      id: jobId,
      taskIds: JSON.stringify(taskIds),
      status: 'pending',
      format: 'pdf',
      fileName,
      createdAt: now,
    });

    // 异步启动 PDF 生成（不阻塞响应）
    setImmediate(() => {
      processExportJob(jobId).catch((err) => {
        console.error('Export job failed:', err);
      });
    });

    return NextResponse.json({
      jobId,
      message: '导出任务已创建，正在生成 PDF...',
    }, { status: 202 });

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '创建导出任务失败',
      details: error.message,
    }, { status: 500 });
  }
}
