'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface ImprovementReport {
  summary: {
    overallAssessment: string;
    keyIssues: Array<{ issue: string; severity: string; count: number }>;
    priorityOrder: string[];
  };
  details: Array<{
    issue: string;
    severity: string;
    dimension: string;
    affectedCases: string[];
    originalConversation: { input: string; output: string };
    analysis: string;
    suggestions: {
      promptModification?: string;
      knowledgeBaseAddition?: string;
      workflowAdjustment?: string;
    };
    expectedImprovement: string;
  }>;
}

export default function ImprovementPage() {
  const params = useParams();
  const taskId = params.id as string;

  const [report, setReport] = useState<ImprovementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReport();
  }, [taskId]);

  async function fetchReport() {
    try {
      const res = await fetch(`/api/tasks/${taskId}/improvement`);
      if (!res.ok) throw new Error('获取改进报告失败');
      const data = await res.json();
      setReport(data.report);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <div className="animate-pulse text-lg">正在生成改进报告...</div>
        <p className="text-sm text-gray-500 mt-2">首次生成需要 30-60 秒</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center text-red-600">{error}</div>
    );
  }

  if (!report) return null;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* 概要 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">改进报告</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 整体评价 */}
          <div className="p-4 bg-blue-50 rounded-lg">
            <h3 className="text-sm font-medium text-blue-800 mb-1">整体评价</h3>
            <p className="text-sm text-blue-700">{report.summary.overallAssessment}</p>
          </div>

          {/* 关键问题清单 */}
          {report.summary.keyIssues.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">关键问题</h3>
              <div className="space-y-2">
                {report.summary.keyIssues.map((issue, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                    <SeverityDot severity={issue.severity} />
                    <span className="text-sm flex-1">{issue.issue}</span>
                    <Badge variant="outline" className="text-xs">{issue.count} 条用例</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 优先级排序 */}
          {report.summary.priorityOrder.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">改进优先级</h3>
              <ol className="list-decimal list-inside text-sm text-gray-600 space-y-1">
                {report.summary.priorityOrder.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 详细建议 */}
      {report.details.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">详细改进建议</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {report.details.map((detail, i) => (
              <div key={i}>
                {i > 0 && <Separator className="mb-6" />}
                <div className="space-y-3">
                  {/* 问题标题 */}
                  <div className="flex items-center gap-2">
                    <SeverityDot severity={detail.severity} />
                    <h4 className="font-medium">{detail.issue}</h4>
                    <Badge variant="outline" className="text-xs">
                      {getDimensionName(detail.dimension)}
                    </Badge>
                  </div>

                  {/* 原始对话 */}
                  <div className="bg-gray-50 rounded-lg p-3 text-sm">
                    <p><strong>用户：</strong>{detail.originalConversation.input}</p>
                    <p className="mt-1"><strong>智能体：</strong>{detail.originalConversation.output}</p>
                  </div>

                  {/* 问题分析 */}
                  <div>
                    <h5 className="text-xs font-medium text-gray-500 mb-1">问题分析</h5>
                    <p className="text-sm text-gray-700">{detail.analysis}</p>
                  </div>

                  {/* 具体建议 */}
                  <div className="space-y-2">
                    {detail.suggestions.promptModification && (
                      <SuggestionBlock
                        title="Prompt 修改建议"
                        content={detail.suggestions.promptModification}
                        color="blue"
                      />
                    )}
                    {detail.suggestions.knowledgeBaseAddition && (
                      <SuggestionBlock
                        title="知识库补充"
                        content={detail.suggestions.knowledgeBaseAddition}
                        color="green"
                      />
                    )}
                    {detail.suggestions.workflowAdjustment && (
                      <SuggestionBlock
                        title="工作流调整"
                        content={detail.suggestions.workflowAdjustment}
                        color="purple"
                      />
                    )}
                  </div>

                  {/* 预期效果 */}
                  <p className="text-xs text-gray-500 italic">
                    预期改进效果：{detail.expectedImprovement}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SuggestionBlock({ title, content, color }: { title: string; content: string; color: string }) {
  const bgColor = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    purple: 'bg-purple-50 border-purple-200',
  }[color] || 'bg-gray-50 border-gray-200';

  return (
    <div className={`p-3 rounded-lg border ${bgColor}`}>
      <h6 className="text-xs font-medium mb-1">{title}</h6>
      <p className="text-sm whitespace-pre-wrap">{content}</p>
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-gray-400',
  }[severity] || 'bg-gray-400';

  return <span className={`w-2 h-2 rounded-full ${color}`} />;
}

function getDimensionName(dim: string): string {
  const names: Record<string, string> = {
    alignment: '预期效果',
    industry: '行业规范',
    boundary: '边界兜底',
    badcase: 'Bad Case',
    security: '安全性',
  };
  return names[dim] || dim;
}
