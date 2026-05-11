import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

/**
 * PUT /api/templates/[id]
 * 更新模板
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const existing = await db.select().from(schema.testTemplates)
    .where(eq(schema.testTemplates.id, id));

  if (existing.length === 0) {
    return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  }

  const updates: any = { updatedAt: Date.now() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.content !== undefined) updates.content = body.content;
  if (body.description !== undefined) updates.description = body.description;
  if (body.dimension !== undefined) updates.dimension = body.dimension;
  if (body.industry !== undefined) updates.industry = body.industry;
  if (body.isActive !== undefined) updates.isActive = body.isActive ? 1 : 0;
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

  await db.update(schema.testTemplates)
    .set(updates)
    .where(eq(schema.testTemplates.id, id));

  const updated = await db.select().from(schema.testTemplates)
    .where(eq(schema.testTemplates.id, id));

  return NextResponse.json({ template: updated[0] });
}

/**
 * DELETE /api/templates/[id]
 * 删除模板
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const existing = await db.select().from(schema.testTemplates)
    .where(eq(schema.testTemplates.id, id));

  if (existing.length === 0) {
    return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  }

  await db.delete(schema.testTemplates).where(eq(schema.testTemplates.id, id));

  return NextResponse.json({ message: '已删除' });
}
