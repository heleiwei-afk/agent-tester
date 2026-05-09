import { Queue, Worker, type ConnectionOptions } from 'bullmq';

const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
};

// 三条队列
export const generationQueue = new Queue('generation', { connection });
export const executionQueue = new Queue('execution', { connection });
export const evaluationQueue = new Queue('evaluation', { connection });

export { connection };
export type { ConnectionOptions };
