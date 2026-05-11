import path from 'path';
import fs from 'fs';
import { createTaskLogger } from '../logger';

const logger = createTaskLogger('backup');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'agent-tester.db');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
const MAX_BACKUPS = 20; // 最多保留 20 个备份

/**
 * 备份数据库
 * 使用 SQLite 的 VACUUM INTO 或文件复制方式创建一致性备份
 * 在任务完成（done/failed）时调用
 */
export async function backupDatabase(reason?: string): Promise<string | null> {
  try {
    // 确保备份目录存在
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // 生成备份文件名：时间戳 + 原因
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const suffix = reason ? `-${reason}` : '';
    const backupName = `agent-tester-${timestamp}${suffix}.db`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    // 检查源数据库是否存在
    if (!fs.existsSync(DB_PATH)) {
      logger.warn('数据库文件不存在，跳过备份');
      return null;
    }

    // 使用 better-sqlite3 的 backup API（保证一致性）
    const Database = (await import('better-sqlite3')).default;
    const sourceDb = new Database(DB_PATH, { readonly: true });

    try {
      await sourceDb.backup(backupPath);
    } finally {
      sourceDb.close();
    }

    logger.info({ backupPath, reason }, '数据库备份完成');

    // 清理旧备份（保留最近 MAX_BACKUPS 个）
    cleanOldBackups();

    return backupPath;
  } catch (error: any) {
    logger.error({ error: error.message }, '数据库备份失败');
    return null;
  }
}

/**
 * 清理旧备份，只保留最近 MAX_BACKUPS 个
 */
function cleanOldBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('agent-tester-') && f.endsWith('.db'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime); // 最新的在前

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        logger.info({ file: file.name }, '清理旧备份');
      }
    }
  } catch (error: any) {
    logger.warn({ error: error.message }, '清理旧备份失败');
  }
}
