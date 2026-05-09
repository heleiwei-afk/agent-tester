/**
 * Worker 进程入口
 * 启动所有后台 Worker（用例生成 + 执行 + 评估）
 * 
 * 运行方式：npx tsx src/workers/start.ts
 */
import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量（Worker 是独立进程，不走 Next.js 的 env 加载）
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { startGenerationWorker } from './generator';
import { startExecutionWorker } from './executor';
import { initDatabase } from '../lib/db/migrate';
import { logger } from '../lib/logger';

// 初始化数据库
initDatabase();

// 启动 Workers
logger.info('启动 Worker 进程...');

const generationWorker = startGenerationWorker();
logger.info('Generation Worker 已启动 (并发: 10)');

const executionWorker = startExecutionWorker();
logger.info(`Execution Worker 已启动 (并发: ${process.env.MAX_CONCURRENCY || 10})`);

// 优雅关闭
process.on('SIGTERM', async () => {
  logger.info('收到 SIGTERM，正在关闭 Workers...');
  await generationWorker.close();
  await executionWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('收到 SIGINT，正在关闭 Workers...');
  await generationWorker.close();
  await executionWorker.close();
  process.exit(0);
});

logger.info('所有 Worker 已就绪，等待任务...');
