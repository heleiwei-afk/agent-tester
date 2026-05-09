'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CaseDetail {
  id: string;
  dimension: string;
  subType: string;
  turns: Array<{ role: string; content: string }>;
  expectation: string;
  passCriteria: string[];
  weight: number;
  status: string;
  verdict: {
    pass: boolean;
    score: number;
    reason: string;
    confidence: number;
    severity: string | null;
    evidence: string | null;
    needsHumanReview: boolean;
    hallucinationCheck: { detected: boolean; details?: string } | null;
  } | null;
  result: {
    responseContent: string | null;
    latencyMs: number | null;
    errorType: string | null;
    errorMsg: string | null;
  } | null;
}

interface Stats {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  passed: number;
  verdictFailed: number;
}

export default function CasesPage() {
  const params = useParams();
  const taskId = params.id as string;

  const [cases, setCases] = useState<CaseDetail[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [dimensionFilter, setDimensionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);

  useEffect(() => {
    fetchCases();
    const interval = setInterval(fetchCases, 3000);
    return () => clearInterval(interval);
  }, [taskId, dimensionFilter, statusFilter]);

  async function fetchCases() {
    try {
      const params = new URLSearchParams();
      if (dimensionFilter !== 'all') params.set('dimension', dimensionFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/tasks/${taskId}/cases?${params}`);
      const data = await res.json();
      setCases(data.cases || []);
      setStats(data.stats || null);
    } catch (err) {
      console.error('获取用例失败', err);
    } finally {
      setLoading(false);
    }
  }

  const progressPct = stats ? Math.round(((stats.done + stats.failed) / Math.max(stats.total, 1)) * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      {/* 顶部进度概览 */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">测试用例详情</h2>
              <p className="text-sm text-gray-500">任务 ID: {taskId.slice(0, 8)}...</p>
            </div>
            {stats && (
              <div className="text-right">
                <p className="text-2xl font-bold">
                  {stats.passed}/{stats.total}
                  <span className="text-sm font-normal text-gray-500 ml-1">通过</span>
                </p>
              </div>
            )}
          </div>
          {stats && stats.total > 0 && (
            <div className="space-y-2">
              <Progress value={progressPct} className="h-2" />
              <div className="flex gap-4 text-xs text-gray-500">
                <span>完成 {stats.done + stats.failed}/{stats.total}</span>
                {stats.running > 0 && <span className="text-blue-600">执行中 {stats.running}</span>}
                {stats.pending > 0 && <span>等待 {stats.pending}</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 筛选器 */}
      <div className="flex gap-3 mb-4">
        <Select value={dimensionFilter} onValueChange={(v) => v && setDimensionFilter(v)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="全部维度" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部维度</SelectItem>
            <SelectItem value="alignment">预期效果</SelectItem>
            <SelectItem value="industry">行业规范</SelectItem>
            <SelectItem value="boundary">边界兜底</SelectItem>
            <SelectItem value="badcase">Bad Case</SelectItem>
            <SelectItem value="security">安全性</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="pass">通过</SelectItem>
            <SelectItem value="fail">失败</SelectItem>
            <SelectItem value="pending">等待中</SelectItem>
            <SelectItem value="running">执行中</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 用例列表 */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : cases.length === 0 ? (
          <div className="text-center py-12 text-gray-500">暂无用例</div>
        ) : (
          cases.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedCase(c)}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CaseStatusIcon status={c.status} verdict={c.verdict} />
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {getDimensionName(c.dimension)}
                        </Badge>
                        <span className="text-sm font-medium">{c.subType}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">
                        {c.turns.filter(t => t.role === 'user').pop()?.content || ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.verdict && (
                      <span className={`text-sm font-mono ${c.verdict.pass ? 'text-green-600' : 'text-red-600'}`}>
                        {c.verdict.score}分
                      </span>
                    )}
                    {c.result?.latencyMs && (
                      <span className="text-xs text-gray-400">{c.result.latencyMs}ms</span>
                    )}
                    {c.verdict?.severity && (
                      <SeverityBadge severity={c.verdict.severity} />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* 用例详情弹窗 */}
      <Dialog open={!!selectedCase} onOpenChange={() => setSelectedCase(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedCase && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CaseStatusIcon status={selectedCase.status} verdict={selectedCase.verdict} />
                  {selectedCase.subType}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                {/* 对话记录 */}
                <div>
                  <h4 className="text-sm font-medium mb-2">对话记录</h4>
                  <div className="space-y-2">
                    {selectedCase.turns.map((turn, i) => (
                      <div key={i} className={`p-3 rounded-lg text-sm ${turn.role === 'user' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                        <span className="text-xs font-medium text-gray-500">
                          {turn.role === 'user' ? '用户' : '助手'}
                        </span>
                        <p className="mt-1">{turn.content}</p>
                      </div>
                    ))}
                    {selectedCase.result?.responseContent && (
                      <div className="p-3 rounded-lg text-sm bg-green-50 border border-green-200">
                        <span className="text-xs font-medium text-green-700">智能体回答</span>
                        <p className="mt-1">{selectedCase.result.responseContent}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 期望 */}
                <div>
                  <h4 className="text-sm font-medium mb-1">期望行为</h4>
                  <p className="text-sm text-gray-600">{selectedCase.expectation}</p>
                </div>

                {/* 通过标准 */}
                <div>
                  <h4 className="text-sm font-medium mb-1">通过标准</h4>
                  <ul className="text-sm text-gray-600 list-disc list-inside">
                    {selectedCase.passCriteria.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>

                {/* 判定结果 */}
                {selectedCase.verdict && (
                  <div className="p-4 rounded-lg border">
                    <h4 className="text-sm font-medium mb-2">判定结果</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>结果：{selectedCase.verdict.pass ? '✅ 通过' : '❌ 失败'}</div>
                      <div>得分：{selectedCase.verdict.score}/100</div>
                      <div>置信度：{(selectedCase.verdict.confidence * 100).toFixed(0)}%</div>
                      {selectedCase.verdict.severity && (
                        <div>严重度：{selectedCase.verdict.severity}</div>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-2">{selectedCase.verdict.reason}</p>
                    {selectedCase.verdict.evidence && (
                      <p className="text-xs text-gray-500 mt-1 italic">证据：{selectedCase.verdict.evidence}</p>
                    )}
                    {selectedCase.verdict.needsHumanReview && (
                      <Badge variant="outline" className="mt-2 text-yellow-600 border-yellow-300">
                        需人工复核
                      </Badge>
                    )}
                  </div>
                )}

                {/* 错误信息 */}
                {selectedCase.result?.errorType && (
                  <div className="p-3 bg-red-50 rounded-lg text-sm text-red-700">
                    <strong>错误：</strong>{selectedCase.result.errorType} - {selectedCase.result.errorMsg}
                  </div>
                )}

                {/* 重试按钮 */}
                {(selectedCase.status === 'failed' || selectedCase.status === 'timeout' || (selectedCase.verdict && !selectedCase.verdict.pass)) && (
                  <button
                    className="w-full py-2 px-4 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                    onClick={async () => {
                      await fetch(`/api/tasks/${taskId}/cases/actions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'retry_case', caseId: selectedCase.id }),
                      });
                      setSelectedCase(null);
                      fetchCases();
                    }}
                  >
                    重新执行此用例
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CaseStatusIcon({ status, verdict }: { status: string; verdict: any }) {
  if (verdict?.pass === true) return <span className="text-green-500">✓</span>;
  if (verdict?.pass === false) return <span className="text-red-500">✗</span>;
  if (status === 'running') return <span className="text-blue-500 animate-pulse">●</span>;
  if (status === 'timeout') return <span className="text-yellow-500">⏱</span>;
  if (status === 'failed') return <span className="text-red-400">!</span>;
  return <span className="text-gray-300">○</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${config[severity] || ''}`}>
      {severity}
    </span>
  );
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
