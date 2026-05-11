import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { TaskConfig, Dimension } from '../types';

const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
};

// 三条队列
export const generationQueue = new Queue('generation', { connection });
export const executionQueue = new Queue('execution', { connection });
export const evaluationQueue = new Queue('evaluation', { connection });

/**
 * 添加用例生成 Job 到队列
 * 新流程：先生成大纲
 */
export async function addGenerationJob(taskId: string, config: TaskConfig, dimensions?: Dimension[]) {
  await generationQueue.add('generate-outline', {
    taskId,
    config,
    dimensions,
  }, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
  });
}

export { connection };
export type { ConnectionOptions };
