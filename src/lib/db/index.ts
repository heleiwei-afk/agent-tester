import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

export { schema };

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * 获取数据库实例（懒加载，避免构建时初始化）
 */
export function getDB() {
  if (!_db) {
    const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'agent-tester.db');

    // 确保数据目录存在
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const sqlite = new Database(DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');

    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

// 向后兼容：导出 db 作为 getter proxy
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDB() as any)[prop];
  },
});

export type DB = ReturnType<typeof getDB>;
