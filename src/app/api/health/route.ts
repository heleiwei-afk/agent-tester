import { NextResponse } from 'next/server';
import IORedis from 'ioredis';

/**
 * GET /api/health — 健康检查
 */
export async function GET() {
  const status: Record<string, string> = {
    app: 'ok',
    redis: 'unknown',
    db: 'unknown',
  };

  // 检查 Redis
  try {
    const redis = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
    });
    await redis.ping();
    status.redis = 'ok';
    await redis.quit();
  } catch {
    status.redis = 'error';
  }

  // 检查 DB
  try {
    const { db } = await import('@/lib/db');
    const { sql } = await import('drizzle-orm');
    await db.run(sql`SELECT 1`);
    status.db = 'ok';
  } catch {
    status.db = 'error';
  }

  const allOk = Object.values(status).every(s => s === 'ok');

  return NextResponse.json(status, { status: allOk ? 200 : 503 });
}
