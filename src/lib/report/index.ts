import { callLLMForJSON } from '../llm';
import type { TestCase, Verdict, TaskConfig, ImprovementReport, Severity } from '../types';
import { getIndustryName } from '../generator/industry-rules';
import { createTaskLogger } from '../logger';

const logger = createTaskLogger('report');

interface ReportData {
  taskId: string;
  config: TaskConfig;
  agentName: string;
  cases: TestCase[];
  verdicts: Verdict[];
  responses: Map<string, string>; // caseId → responseContent
  startedAt: number;
  finishedAt: number;
}

/**
 * 生成 Markdown 测试报告
 */
export function generateMarkdownReport(data: ReportData): string {
  const { config, agentName, cases, verdicts, startedAt, finishedAt } = data;

  const totalCases = cases.length;
  const passedCases = verdicts.filter(v => v.pass).length;
  const failedCases = totalCases - passedCases;
  const passRate = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
  const overallScore = calculateOverallScore(verdicts, cases);
  const duration = Math.round((finishedAt - startedAt) / 1000);

  // 按维度分组
  const byDimension = groupByDimension(cases, verdicts);

  // 按严重度分组失败用例
  const failedVerdicts = verdicts.filter(v => !v.pass);
  const bySeverity = groupBySeverity(failedVerdicts);

  let md = '';

  // 封面
  md += `# 智能体测试报告\n\n`;
  md += `| 项目 | 信息 |\n|---|---|\n`;
  md += `| 智能体名称 | ${agentName} |\n`;
  md += `| 所属平台 | ${getPlatformName(config.platform)} |\n`;
  md += `| 行业 | ${getIndustryName(config.industry)} |\n`;
  md += `| 测试时间 | ${new Date(startedAt).toLocaleString('zh-CN')} |\n`;
  md += `| 耗时 | ${duration} 秒 |\n`;
  md += `| 用例总数 | ${totalCases} |\n`;
  md += `| 通过 / 失败 | ${passedCases} / ${failedCases} |\n`;
  md += `| 通过率 | ${passRate}% |\n`;
  md += `| 综合评分 | ${overallScore}/100 |\n\n`;

  // 总览
  md += `## 总览\n\n`;
  md += `### 各维度得分\n\n`;
  md += `| 维度 | 用例数 | 通过数 | 通过率 | 得分 |\n|---|---|---|---|---|\n`;
  for (const [dim, info] of Object.entries(byDimension)) {
    md += `| ${getDimensionName(dim)} | ${info.total} | ${info.passed} | ${info.passRate}% | ${info.score}/100 |\n`;
  }
  md += '\n';

  // 严重度分布
  if (failedVerdicts.length > 0) {
    md += `### 严重度分布\n\n`;
    md += `| 严重度 | 数量 | 占比 |\n|---|---|---|\n`;
    for (const [sev, count] of Object.entries(bySeverity)) {
      md += `| ${getSeverityName(sev)} | ${count} | ${Math.round((count / failedCases) * 100)}% |\n`;
    }
    md += '\n';
  }

  // 高严重度失败用例
  const criticalFails = failedVerdicts.filter(v => v.severity === 'critical' || v.severity === 'high');
  if (criticalFails.length > 0) {
    md += `## ⚠️ 高严重度问题（优先关注）\n\n`;
    for (const verdict of criticalFails) {
      const testCase = cases.find(c => c.id === verdict.caseId);
      if (!testCase) continue;
      const response = data.responses.get(verdict.caseId) || '(无响应)';
      const lastUserMsg = testCase.turns.filter(t => t.role === 'user').pop()?.content || '';

      md += `### [${getDimensionName(testCase.dimension)}] ${testCase.subType}\n\n`;
      md += `- **严重度**：${getSeverityName(verdict.severity || 'medium')}\n`;
      md += `- **用户输入**：${lastUserMsg}\n`;
      md += `- **智能体回答**：${response.slice(0, 300)}${response.length > 300 ? '...' : ''}\n`;
      md += `- **判定理由**：${verdict.reason}\n`;
      if (verdict.evidence) md += `- **证据**：${verdict.evidence}\n`;
      if (verdict.hallucinationCheck?.detected) {
        md += `- **⚠️ 幻觉检测**：${verdict.hallucinationCheck.details}\n`;
      }
      md += '\n---\n\n';
    }
  }

  // 争议用例（双判不一致）
  const disputedVerdicts = verdicts.filter(v => !v.dualJudge.consensus);
  if (disputedVerdicts.length > 0) {
    md += `## 争议用例（双判不一致，需人工确认）\n\n`;
    for (const verdict of disputedVerdicts) {
      const testCase = cases.find(c => c.id === verdict.caseId);
      if (!testCase) continue;
      const lastUserMsg = testCase.turns.filter(t => t.role === 'user').pop()?.content || '';

      md += `- **${testCase.subType}**：${lastUserMsg.slice(0, 50)}...\n`;
      md += `  - Judge1: ${verdict.dualJudge.judge1.pass ? '✅' : '❌'} (${verdict.dualJudge.judge1.score}分)\n`;
      md += `  - Judge2: ${verdict.dualJudge.judge2.pass ? '✅' : '❌'} (${verdict.dualJudge.judge2.score}分)\n\n`;
    }
  }

  // 需人工复核
  const needsReview = verdicts.filter(v => v.needsHumanReview);
  if (needsReview.length > 0) {
    md += `## 需人工复核（${needsReview.length} 条）\n\n`;
    md += `以下用例的判定置信度较低，建议人工确认：\n\n`;
    for (const verdict of needsReview.slice(0, 10)) {
      const testCase = cases.find(c => c.id === verdict.caseId);
      if (!testCase) continue;
      md += `- [${testCase.dimension}] ${testCase.subType}：置信度 ${(verdict.confidence * 100).toFixed(0)}%\n`;
    }
    if (needsReview.length > 10) {
      md += `\n...及其他 ${needsReview.length - 10} 条\n`;
    }
    md += '\n';
  }

  // 异常报告
  md += `## 异常报告\n\n`;
  md += `| 类型 | 次数 | 说明 |\n|---|---|---|\n`;
  const timeouts = cases.filter(c => c.status === 'timeout').length;
  const errors = cases.filter(c => c.status === 'failed').length;
  md += `| 超时 | ${timeouts} | ${timeouts > 0 ? '部分用例执行超时' : '无'} |\n`;
  md += `| API错误 | ${errors} | ${errors > 0 ? '部分用例调用失败' : '无'} |\n`;
  md += `| 幻觉检测 | ${verdicts.filter(v => v.hallucinationCheck?.detected).length} | 检测到可能的事实编造 |\n`;
  md += `| 判分异常 | ${disputedVerdicts.length} | 双判不一致 |\n\n`;

  // 详细结果
  md += `## 详细结果\n\n`;
  for (const [dim, info] of Object.entries(byDimension)) {
    md += `### ${getDimensionName(dim)}（${info.passed}/${info.total} 通过）\n\n`;
    const dimCases = cases.filter(c => c.dimension === dim);
    for (const tc of dimCases) {
      const verdict = verdicts.find(v => v.caseId === tc.id);
      const status = verdict ? (verdict.pass ? '✅' : '❌') : '⏳';
      const lastUserMsg = tc.turns.filter(t => t.role === 'user').pop()?.content || '';
      md += `- ${status} **${tc.subType}**：${lastUserMsg.slice(0, 60)}${lastUserMsg.length > 60 ? '...' : ''}\n`;
      if (verdict && !verdict.pass) {
        md += `  - 理由：${verdict.reason.slice(0, 100)}\n`;
      }
    }
    md += '\n';
  }

  return md;
}

/**
 * 生成两级改进报告
 */
export async function generateImprovementReport(data: ReportData): Promise<ImprovementReport> {
  const failedVerdicts = data.verdicts.filter(v => !v.pass);

  if (failedVerdicts.length === 0) {
    return {
      summary: {
        overallAssessment: '所有测试用例均通过，智能体表现优秀。',
        keyIssues: [],
        priorityOrder: [],
      },
      details: [],
    };
  }

  // 汇总失败信息
  const failSummary = failedVerdicts.map(v => {
    const tc = data.cases.find(c => c.id === v.caseId);
    const response = data.responses.get(v.caseId) || '';
    return {
      dimension: tc?.dimension || 'unknown',
      subType: tc?.subType || 'unknown',
      userInput: tc?.turns.filter(t => t.role === 'user').pop()?.content || '',
      response: response.slice(0, 500),
      reason: v.reason,
      severity: v.severity || 'medium',
      hallucinationDetected: v.hallucinationCheck?.detected || false,
    };
  });

  try {
    const report = await callLLMForJSON<ImprovementReport>({
      systemPrompt: `你是一位资深的智能体优化顾问。
根据测试失败的用例，生成结构化的改进报告。

报告分两级：
1. 概要方向：整体评价 + 关键问题清单 + 优先级排序
2. 逐问题详细建议：每个问题的具体修改方案（包括 Prompt 修改建议、知识库补充、工作流调整）

【要求】
- 建议必须具体可执行，不要泛泛而谈
- Prompt 修改建议要给出具体文案示例
- 按严重度和影响面排序
- 预估每个改进的效果`,
      userPrompt: `【智能体描述】${data.config.expectedBehavior}
【行业】${data.config.industry}
【失败用例汇总】${JSON.stringify(failSummary, null, 2)}

请生成改进报告，输出JSON格式的 ImprovementReport：
{
  "summary": {
    "overallAssessment": "整体评价",
    "keyIssues": [{"issue": "问题描述", "severity": "high", "count": 3}],
    "priorityOrder": ["最优先改进的方向", "其次", ...]
  },
  "details": [
    {
      "issue": "具体问题",
      "severity": "high",
      "dimension": "alignment",
      "affectedCases": ["用例描述"],
      "originalConversation": {"input": "用户输入", "output": "智能体回答"},
      "analysis": "问题分析",
      "suggestions": {
        "promptModification": "具体的 Prompt 修改建议文案",
        "knowledgeBaseAddition": "需要补充的知识内容",
        "workflowAdjustment": "工作流调整建议"
      },
      "expectedImprovement": "预期改进效果"
    }
  ]
}`,
      temperature: 0.4,
      maxTokens: 8192,
      model: process.env.LLM_EVALUATION_MODEL || 'claude-opus-4-6',
    });

    return report;
  } catch (error) {
    logger.error({ error }, '改进报告生成失败');
    return {
      summary: {
        overallAssessment: '改进报告生成失败，请查看测试报告中的失败用例详情。',
        keyIssues: failedVerdicts.slice(0, 5).map(v => ({
          issue: v.reason,
          severity: (v.severity || 'medium') as Severity,
          count: 1,
        })),
        priorityOrder: [],
      },
      details: [],
    };
  }
}

// --- 辅助函数 ---

function calculateOverallScore(verdicts: Verdict[], cases: TestCase[]): number {
  if (verdicts.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const verdict of verdicts) {
    const tc = cases.find(c => c.id === verdict.caseId);
    const weight = tc?.weight || 3;
    weightedSum += verdict.score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

function groupByDimension(cases: TestCase[], verdicts: Verdict[]) {
  const result: Record<string, { total: number; passed: number; passRate: number; score: number }> = {};

  const dimensions = [...new Set(cases.map(c => c.dimension))];
  for (const dim of dimensions) {
    const dimCases = cases.filter(c => c.dimension === dim);
    const dimVerdicts = verdicts.filter(v => dimCases.some(c => c.id === v.caseId));
    const passed = dimVerdicts.filter(v => v.pass).length;
    const total = dimCases.length;
    const avgScore = dimVerdicts.length > 0
      ? Math.round(dimVerdicts.reduce((sum, v) => sum + v.score, 0) / dimVerdicts.length)
      : 0;

    result[dim] = {
      total,
      passed,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
      score: avgScore,
    };
  }

  return result;
}

function groupBySeverity(verdicts: Verdict[]): Record<string, number> {
  const result: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of verdicts) {
    const sev = v.severity || 'medium';
    result[sev] = (result[sev] || 0) + 1;
  }
  return result;
}

function getPlatformName(platform: string): string {
  const names: Record<string, string> = {
    bailian: '阿里百炼',
    coze_cn: 'Coze 国内版',
    coze_global: 'Coze 国际版',
  };
  return names[platform] || platform;
}

function getDimensionName(dim: string): string {
  const names: Record<string, string> = {
    alignment: '预期效果验证',
    industry: '行业规范合规',
    boundary: '边界与兜底',
    badcase: '高频 Bad Case',
    security: '安全性',
  };
  return names[dim] || dim;
}

function getSeverityName(sev: string): string {
  const names: Record<string, string> = {
    critical: '🔴 严重',
    high: '🟠 高',
    medium: '🟡 中',
    low: '🟢 低',
  };
  return names[sev] || sev;
}

// ============================================================
// 增量报告功能
// ============================================================

/**
 * 将单条用例的测试结果格式化为 Markdown，用于追加到实时报告
 */
export function formatCaseResult(
  caseIndex: number,
  testCase: TestCase,
  verdict: Verdict,
  responseContent: string
): string {
  const statusIcon = verdict.pass ? '✓' : '✗';
  const severityTag = verdict.severity ? ` ${getSeverityName(verdict.severity)}` : '';
  const lastUserMsg = testCase.turns.filter(t => t.role === 'user').pop()?.content || '';

  let md = `### #${caseIndex + 1} [${getDimensionName(testCase.dimension)}] ${testCase.subType} ${statusIcon} (${verdict.score}分)${severityTag}\n`;
  md += `- **输入**：${lastUserMsg.slice(0, 200)}${lastUserMsg.length > 200 ? '...' : ''}\n`;
  md += `- **输出**：${responseContent.slice(0, 300)}${responseContent.length > 300 ? '...' : ''}\n`;
  md += `- **判定**：${verdict.pass ? '通过' : '失败'} | 置信度 ${(verdict.confidence * 100).toFixed(0)}% | 策略：${verdict.strategyUsed}\n`;

  if (!verdict.pass && verdict.reason) {
    md += `- **原因**：${verdict.reason.slice(0, 200)}\n`;
  }
  if (verdict.evidence) {
    md += `- **证据**：${verdict.evidence.slice(0, 150)}\n`;
  }
  if (verdict.hallucinationCheck?.detected) {
    md += `- **⚠️ 幻觉**：${verdict.hallucinationCheck.details || '检测到可能的事实编造'}\n`;
  }
  if (!verdict.dualJudge.consensus) {
    md += `- **⚠️ 争议**：双判不一致（Judge1: ${verdict.dualJudge.judge1.pass ? 'pass' : 'fail'}, Judge2: ${verdict.dualJudge.judge2.pass ? 'pass' : 'fail'}）\n`;
  }

  md += '\n';
  return md;
}

/**
 * 生成最终总结（全部用例完成后调用）
 * 包含：整体测试结果 + 各维度得分 + 改进建议
 */
export async function generateFinalSummary(
  config: TaskConfig,
  agentName: string,
  cases: TestCase[],
  verdicts: Verdict[],
  startedAt: number,
  finishedAt: number
): Promise<string> {
  const totalCases = cases.length;
  const passedCases = verdicts.filter(v => v.pass).length;
  const failedCases = totalCases - passedCases;
  const passRate = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
  const overallScore = calculateOverallScore(verdicts, cases);
  const duration = Math.round((finishedAt - startedAt) / 1000);

  // 按维度统计
  const byDimension = groupByDimension(cases, verdicts);
  const bySeverity = groupBySeverity(verdicts.filter(v => !v.pass));

  let summary = `# 智能体测试报告\n\n`;
  summary += `## 测试概况\n\n`;
  summary += `| 项目 | 信息 |\n|---|---|\n`;
  summary += `| 智能体名称 | ${agentName} |\n`;
  summary += `| 所属平台 | ${getPlatformName(config.platform)} |\n`;
  summary += `| 行业 | ${getIndustryName(config.industry)} |\n`;
  summary += `| 测试时间 | ${new Date(startedAt).toLocaleString('zh-CN')} |\n`;
  summary += `| 耗时 | ${duration} 秒 |\n`;
  summary += `| 用例总数 | ${totalCases} |\n`;
  summary += `| 通过 / 失败 | ${passedCases} / ${failedCases} |\n`;
  summary += `| 通过率 | ${passRate}% |\n`;
  summary += `| 综合评分 | ${overallScore}/100 |\n\n`;

  summary += `### 各维度得分\n\n`;
  summary += `| 维度 | 用例数 | 通过数 | 通过率 | 得分 |\n|---|---|---|---|---|\n`;
  for (const [dim, info] of Object.entries(byDimension)) {
    summary += `| ${getDimensionName(dim)} | ${info.total} | ${info.passed} | ${info.passRate}% | ${info.score}/100 |\n`;
  }
  summary += '\n';

  if (failedCases > 0) {
    summary += `### 严重度分布\n\n`;
    summary += `| 严重度 | 数量 |\n|---|---|\n`;
    for (const [sev, count] of Object.entries(bySeverity)) {
      if (count > 0) summary += `| ${getSeverityName(sev)} | ${count} |\n`;
    }
    summary += '\n';
  }

  // 生成改进建议（限制 top 20 条失败用例）
  const failedVerdicts = verdicts.filter(v => !v.pass);
  const topFailed = failedVerdicts
    .sort((a, b) => {
      const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (sevOrder[a.severity || 'low'] ?? 4) - (sevOrder[b.severity || 'low'] ?? 4);
    })
    .slice(0, 20);

  if (topFailed.length > 0) {
    try {
      const improvementResult = await callLLMForJSON<ImprovementReport>({
        systemPrompt: `你是一位资深的智能体优化顾问。根据测试失败的用例，生成简洁的改进建议。
报告分两级：1. 概要方向（3-5条关键问题）2. 每个问题的具体修改建议（包括 Prompt 修改建议）。
建议必须具体可执行。`,
        userPrompt: `【智能体描述】${config.expectedBehavior}
【行业】${config.industry}
【失败用例（top ${topFailed.length} 条，按严重度排序）】
${JSON.stringify(topFailed.map(v => {
  const tc = cases.find(c => c.id === v.caseId);
  return {
    dimension: tc?.dimension,
    subType: tc?.subType,
    userInput: tc?.turns.filter(t => t.role === 'user').pop()?.content?.slice(0, 100),
    reason: v.reason?.slice(0, 100),
    severity: v.severity,
  };
}), null, 2)}

输出JSON: {"summary":{"overallAssessment":"...","keyIssues":[{"issue":"...","severity":"...","count":1}],"priorityOrder":["..."]},"details":[{"issue":"...","severity":"...","dimension":"...","analysis":"...","suggestions":{"promptModification":"...","knowledgeBaseAddition":"..."},"expectedImprovement":"..."}]}`,
        temperature: 0.4,
        maxTokens: 8192,
        model: process.env.LLM_EVALUATION_MODEL || 'claude-opus-4-6',
      });

      summary += `## 整体改进建议\n\n`;
      summary += `### 评价\n\n${improvementResult.summary.overallAssessment}\n\n`;

      if (improvementResult.summary.keyIssues.length > 0) {
        summary += `### 关键问题\n\n`;
        for (const issue of improvementResult.summary.keyIssues) {
          summary += `- **${getSeverityName(issue.severity)}** ${issue.issue}（${issue.count} 条用例）\n`;
        }
        summary += '\n';
      }

      if (improvementResult.summary.priorityOrder.length > 0) {
        summary += `### 改进优先级\n\n`;
        improvementResult.summary.priorityOrder.forEach((item, i) => {
          summary += `${i + 1}. ${item}\n`;
        });
        summary += '\n';
      }

      if (improvementResult.details.length > 0) {
        summary += `### 具体建议\n\n`;
        for (const detail of improvementResult.details) {
          summary += `#### ${detail.issue}\n\n`;
          summary += `- **分析**：${detail.analysis}\n`;
          if (detail.suggestions.promptModification) {
            summary += `- **Prompt 修改**：${detail.suggestions.promptModification}\n`;
          }
          if (detail.suggestions.knowledgeBaseAddition) {
            summary += `- **知识库补充**：${detail.suggestions.knowledgeBaseAddition}\n`;
          }
          summary += '\n';
        }
      }

      return summary;
    } catch (error) {
      logger.error({ error }, '改进建议生成失败');
    }
  }

  summary += `## 整体改进建议\n\n`;
  if (failedCases === 0) {
    summary += `所有测试用例均通过，智能体表现优秀。\n\n`;
  } else {
    summary += `共 ${failedCases} 条用例未通过，请查看下方详细结果中标记为 ✗ 的用例。\n\n`;
  }

  return summary;
}
