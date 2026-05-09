import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

/**
 * 创建带有任务/用例上下文的子 logger
 */
export function createTaskLogger(taskId: string, caseId?: string) {
  return logger.child({ taskId, ...(caseId ? { caseId } : {}) });
}
