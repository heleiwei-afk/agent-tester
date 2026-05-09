import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';
import { generateMarkdownReport } from '@/lib/report';
import JSZip from 'jszip';

/**
 * POST /api/tasks/batch-export — 批量导出测试报告和改进报告
 * Body: { taskIds: string[] }
 * Response: ZIP 文件
 */
export async function POST(request: NextRequest) {
  try {
    const { taskIds } = await request.json();

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json({ code: 'INVALID_INPUT', message: '请选择至少一个任务' }, { status: 400 });
    }

    const zip = new JSZip();

    for (const taskId of taskIds) {
      const task = await db.query.tasks.findFirst({
        where: eq(schema.tasks.id, taskId),
      });

      if (!task) continue;

      const agentName = task.agentName || `任务-${taskId.slice(0, 8)}`;
      // 清理文件名中的非法字符
      const safeName = agentName.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 50);

      // 测试报告
      if (task.reportContent) {
        zip.file(`${safeName}_测试报告.md`, task.reportContent);
      } else {
        // 降级：用旧逻辑生成
        const cases = await db.select().from(schema.cases).where(eq(schema.cases.taskId, taskId));
        const verdicts = await db.select().from(schema.verdicts).where(eq(schema.verdicts.taskId, taskId));
        const results = await db.select().from(schema.results).where(eq(schema.results.taskId, taskId));

        const responses = new Map<string, string>();
        for (const r of results) {
          if (r.responseContent) responses.set(r.caseId, r.responseContent);
        }

        const config = JSON.parse(task.configJson);
        const reportData = {
          taskId,
          config,
          agentName,
          cases: cases.map(c => ({
            id: c.id, taskId: c.taskId, dimension: c.dimension as any,
            subType: c.subType, turns: JSON.parse(c.turnsJson),
            expectation: c.expectation, passCriteria: JSON.parse(c.passCriteriaJson),
            weight: c.weight, evaluationStrategy: c.evaluationStrategy as any,
            status: c.status as any, orderIndex: c.orderIndex,
          })),
          verdicts: verdicts.map(v => ({
            caseId: v.caseId, pass: v.pass === 1, score: v.score,
            reason: v.reason, confidence: v.confidence,
            severity: v.severity as any, suggestion: v.suggestion || undefined,
            evidence: v.evidence || '', strategyUsed: v.strategyUsed as any,
            dualJudge: v.dualJudgeJson ? JSON.parse(v.dualJudgeJson) : { judge1: {}, judge2: {}, consensus: true },
            hallucinationCheck: v.hallucinationJson ? JSON.parse(v.hallucinationJson) : { detected: false },
            needsHumanReview: v.needsHumanReview === 1,
          })),
          responses,
          startedAt: task.startedAt || task.createdAt,
          finishedAt: task.finishedAt || Date.now(),
        };

        const markdown = generateMarkdownReport(reportData);
        zip.file(`${safeName}_测试报告.md`, markdown);
      }

      // 改进报告
      if (task.improvementReport) {
        const improvement = JSON.parse(task.improvementReport);
        let improvementMd = `# 改进报告 · ${agentName}\n\n`;
        improvementMd += `## 整体评价\n\n${improvement.summary?.overallAssessment || '无'}\n\n`;

        if (improvement.summary?.keyIssues?.length > 0) {
          improvementMd += `## 关键问题\n\n`;
          for (const issue of improvement.summary.keyIssues) {
            improvementMd += `- **[${issue.severity}]** ${issue.issue}（${issue.count} 条用例）\n`;
          }
          improvementMd += '\n';
        }

        if (improvement.details?.length > 0) {
          improvementMd += `## 详细建议\n\n`;
          for (const detail of improvement.details) {
            improvementMd += `### ${detail.issue}\n\n`;
            improvementMd += `- 分析：${detail.analysis || ''}\n`;
            if (detail.suggestions?.promptModification) {
              improvementMd += `- Prompt 修改：${detail.suggestions.promptModification}\n`;
            }
            if (detail.suggestions?.knowledgeBaseAddition) {
              improvementMd += `- 知识库补充：${detail.suggestions.knowledgeBaseAddition}\n`;
            }
            improvementMd += '\n';
          }
        }

        zip.file(`${safeName}_改进报告.md`, improvementMd);
      } else if (task.reportContent && task.reportContent.includes('## 整体改进建议')) {
        // 改进建议已嵌入在 reportContent 中，提取出来
        const improvementStart = task.reportContent.indexOf('## 整体改进建议');
        const improvementEnd = task.reportContent.indexOf('\n---\n', improvementStart);
        if (improvementStart !== -1) {
          const improvementSection = improvementEnd !== -1
            ? task.reportContent.slice(improvementStart, improvementEnd)
            : task.reportContent.slice(improvementStart);
          zip.file(`${safeName}_改进报告.md`, `# 改进报告 · ${agentName}\n\n${improvementSection}`);
        }
      }
    }

    // 生成 ZIP
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="batch_export_${date}.zip"`,
      },
    });

  } catch (error: any) {
    return NextResponse.json({
      code: 'INTERNAL_ERROR',
      message: '批量导出失败',
      details: error.message,
    }, { status: 500 });
  }
}
