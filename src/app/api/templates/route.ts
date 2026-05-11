import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and, like } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { initDatabase } from '@/lib/db/migrate';

// 确保数据库初始化
let dbInit = false;
function ensureDB() {
  if (!dbInit) { initDatabase(); dbInit = true; }
}

/**
 * GET /api/templates?type=dimension&dimension=alignment&industry=education
 * 获取模板列表，支持按 type/dimension/industry 筛选
 */
export async function GET(request: Request) {
  ensureDB();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const dimension = searchParams.get('dimension');
  const industry = searchParams.get('industry');

  let query = db.select().from(schema.testTemplates);

  // 构建条件
  const conditions: any[] = [];
  if (type) conditions.push(eq(schema.testTemplates.type, type));
  if (dimension) conditions.push(eq(schema.testTemplates.dimension, dimension));
  if (industry) conditions.push(eq(schema.testTemplates.industry, industry));

  let results;
  if (conditions.length === 0) {
    results = await db.select().from(schema.testTemplates);
  } else if (conditions.length === 1) {
    results = await db.select().from(schema.testTemplates).where(conditions[0]);
  } else {
    results = await db.select().from(schema.testTemplates).where(and(...conditions));
  }

  // 按 sortOrder 排序
  results.sort((a, b) => a.sortOrder - b.sortOrder);

  return NextResponse.json({ templates: results });
}

/**
 * POST /api/templates
 * 创建新模板
 */
export async function POST(request: Request) {
  ensureDB();
  const body = await request.json();
  const { type, dimension, industry, name, content, description, isActive, sortOrder } = body;

  if (!type || !name || !content) {
    return NextResponse.json({ error: '缺少必填字段: type, name, content' }, { status: 400 });
  }

  const now = Date.now();
  const id = uuid();

  await db.insert(schema.testTemplates).values({
    id,
    type,
    dimension: dimension || null,
    industry: industry || null,
    name,
    content,
    description: description || null,
    isActive: isActive !== undefined ? (isActive ? 1 : 0) : 1,
    sortOrder: sortOrder || 0,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.select().from(schema.testTemplates).where(eq(schema.testTemplates.id, id));

  return NextResponse.json({ template: created[0] }, { status: 201 });
}
