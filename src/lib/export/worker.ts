import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateMarkdownReport } from '@/lib/report';
import { generatePDFReport } from '@/lib/report/pdf';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';

const EXPORT_DIR = join(process.cwd(), 'data', 'exports');

/**
 * 后台处理导出任务
 * 生成 PDF（单个任务直接 PDF，多个任务打包 ZIP）
 */
export async function processExportJob(jobId: string) {
  // 确保导出目录存在
  if (!existsSync(EXPORT_DIR)) {
    await mkdir(EXPORT_DIR, { recursive: true });
  }

  // 更新状态为 processing
  await db.update(schema.exportJobs).set({ status: 'processing' }).where(eq(schema.exportJobs.id, jobId));

  try {
    const job = await db.query.exportJobs.findFirst({
      where: eq(schema.exportJobs.id, jobId),
    });
    if (!job) throw new Error('导出任务不存在');

    const taskIds: string[] = JSON.parse(job.taskIds);
    const isSingle = taskIds.length === 1;

    if (isSingle) {
      // 单个任务：直接生成 PDF
      const result = await generateSinglePDF(taskIds[0]);
      const filePath = join(EXPORT_DIR, `${jobId}.pdf`);

      if (result.pdf) {
        await writeFile(filePath, result.pdf);
        await db.update(schema.exportJobs).set({
          status: 'done',
          filePath,
          fileName: `${result.name}_测试报告.pdf`,
          fileSize: result.pdf.length,
          finishedAt: Date.now(),
        }).where(eq(schema.exportJobs.id, jobId));
      } else {
        // PDF 失败，降级为 MD
        const mdPath = join(EXPORT_DIR, `${jobId}.md`);
        const mdContent = result.markdown || '报告生成失败';
        await writeFile(mdPath, mdContent);
        await db.update(schema.exportJobs).set({
          status: 'done',
          filePath: mdPath,
          fileName: `${result.name}_测试报告.md`,
          fileSize: Buffer.byteLength(mdContent),
          finishedAt: Date.now(),
        }).where(eq(schema.exportJobs.id, jobId));
      }
    } else {
      // 多个任务：打包 ZIP
      const zip = new JSZip();

      for (const taskId of taskIds) {
        const result = await generateSinglePDF(taskId);
        const safeName = result.name.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 50);

        if (result.pdf) {
          zip.file(`${safeName}_测试报告.pdf`, result.pdf);
        } else if (result.markdown) {
          zip.file(`${safeName}_测试报告.md`, result.markdown);
        }

        // 附加改进报告（MD 格式）
        if (result.improvementMd) {
          zip.file(`${safeName}_改进报告.md`, result.improvementMd);
        }
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const filePath = join(EXPORT_DIR, `${jobId}.zip`);
      await writeFile(filePath, zipBuffer);

      const date = new Date().toISOString().slice(0, 10);
      await db.update(schema.exportJobs).set({
        status: 'done',
        filePath,
        fileName: `批量导出_${date}.zip`,
        fileSize: zipBuffer.length,
        finishedAt: Date.now(),
      }).where(eq(schema.exportJobs.id, jobId));
    }

  } catch (error: any) {
    await db.update(schema.exportJobs).set({
      status: 'failed',
      errorMessage: error.message || '未知错误',
      finishedAt: Date.now(),
    }).where(eq(schema.exportJobs.id, jobId));
  }
}

/**
 * 为单个任务生成 PDF + 改进报告
 */
async function generateSinglePDF(taskId: string): Promise<{
  name: string;
  pdf: Buffer | null;
  markdown: string | null;
  improvementMd: string | null;
}> {
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });

  if (!task) {
    return { name: `任务-${taskId.slice(0, 8)}`, pdf: null, markdown: null, improvementMd: null };
  }

  const agentName = task.agentName || `任务-${taskId.slice(0, 8)}`;
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
      status: c.status as any, newSession: c.newSession === 1, orderIndex: c.orderIndex,
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

  // 尝试生成 PDF
  let pdf: Buffer | null = null;
  if (cases.length > 0 && verdicts.length > 0) {
    try {
      pdf = await generatePDFReport(reportData);
    } catch {}
  }

  // 生成 markdown（作为 PDF 降级或独立使用）
  let markdown: string | null = null;
  if (!pdf) {
    markdown = task.reportContent || (cases.length > 0 ? generateMarkdownReport(reportData) : null);
  }

  // 改进报告
  let improvementMd: string | null = null;
  if (task.improvementReport) {
    const improvement = JSON.parse(task.improvementReport);
    let md = `# 改进报告 · ${agentName}\n\n`;
    md += `## 整体评价\n\n${improvement.summary?.overallAssessment || '无'}\n\n`;

    if (improvement.summary?.keyIssues?.length > 0) {
      md += `## 关键问题\n\n`;
      for (const issue of improvement.summary.keyIssues) {
        md += `- **[${issue.severity}]** ${issue.issue}（${issue.count} 条用例）\n`;
      }
      md += '\n';
    }

    if (improvement.details?.length > 0) {
      md += `## 详细建议\n\n`;
      for (const detail of improvement.details) {
        md += `### ${detail.issue}\n\n`;
        md += `- 分析：${detail.analysis || ''}\n`;
        if (detail.suggestions?.promptModification) {
          md += `- Prompt 修改：${detail.suggestions.promptModification}\n`;
        }
        if (detail.suggestions?.knowledgeBaseAddition) {
          md += `- 知识库补充：${detail.suggestions.knowledgeBaseAddition}\n`;
        }
        md += '\n';
      }
    }
    improvementMd = md;
  }

  return { name: agentName, pdf, markdown, improvementMd };
}
