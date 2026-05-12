import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * GET /api/export/[id] — 查询导出任务状态 / 下载文件
 *
 * 返回：
 * - status=pending/processing → JSON { status, message }
 * - status=done → 文件流（PDF 或 ZIP）
 * - status=failed → JSON { status, error }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = await db.query.exportJobs.findFirst({
    where: eq(schema.exportJobs.id, id),
  });

  if (!job) {
    return NextResponse.json({ code: 'NOT_FOUND', message: '导出任务不存在' }, { status: 404 });
  }

  if (job.status === 'pending' || job.status === 'processing') {
    return NextResponse.json({
      status: job.status,
      message: job.status === 'pending' ? '等待处理...' : '正在生成 PDF...',
    });
  }

  if (job.status === 'failed') {
    return NextResponse.json({
      status: 'failed',
      error: job.errorMessage || '导出失败',
    });
  }

  // status === 'done'，返回文件
  if (!job.filePath || !existsSync(job.filePath)) {
    return NextResponse.json({
      status: 'failed',
      error: '导出文件不存在或已过期',
    }, { status: 410 });
  }

  try {
    const fileBuffer = await readFile(job.filePath);
    const isZip = job.filePath.endsWith('.zip');
    const contentType = isZip ? 'application/zip' : 'application/pdf';
    const fileName = job.fileName || (isZip ? 'export.zip' : 'report.pdf');

    // 下载后清理临时文件
    setImmediate(async () => {
      try {
        await unlink(job.filePath!);
        await db.delete(schema.exportJobs).where(eq(schema.exportJobs.id, id));
      } catch {}
    });

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': String(fileBuffer.length),
      },
    });
  } catch (error: any) {
    return NextResponse.json({
      status: 'failed',
      error: '读取导出文件失败',
    }, { status: 500 });
  }
}
