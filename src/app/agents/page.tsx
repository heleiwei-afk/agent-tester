'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface AgentRecord {
  id: string;
  agentName: string;
  platform: string;
  botId: string;
  testTime: number | null;
  casesLink: string;
  passRate: string;
  overallScore: number | string;
  status: string;
  hasReport: boolean;
  hasImprovementReport: boolean;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchAgents();
  }, []);

  async function fetchAgents() {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (err) {
      console.error('获取智能体列表失败', err);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === agents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(agents.map(a => a.id)));
    }
  }

  async function handleBatchExport() {
    if (selectedIds.size === 0) return;
    setExporting(true);
    try {
      const res = await fetch('/api/tasks/batch-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: Array.from(selectedIds) }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `批量导出_${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('批量导出失败', err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">智能体测试记录</CardTitle>
              <p className="text-sm text-gray-500">
                所有已完成测试的智能体记录，包含评分和改进建议
              </p>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">已选 {selectedIds.size} 项</span>
                <button
                  className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  onClick={handleBatchExport}
                  disabled={exporting}
                >
                  {exporting ? '导出中...' : '批量导出'}
                </button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12 text-gray-500">加载中...</div>
          ) : agents.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">暂无测试记录</p>
              <Link href="/" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
                创建第一个测试任务
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === agents.length && agents.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </TableHead>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>智能体名称</TableHead>
                  <TableHead>平台</TableHead>
                  <TableHead>测试时间</TableHead>
                  <TableHead>用例通过</TableHead>
                  <TableHead>评分</TableHead>
                  <TableHead>报告</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent, index) => (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(agent.id)}
                        onChange={() => toggleSelect(agent.id)}
                        className="rounded"
                      />
                    </TableCell>
                    <TableCell className="text-gray-400">{index + 1}</TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={agent.casesLink}
                        className="text-blue-600 hover:underline"
                      >
                        {agent.agentName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{getPlatformName(agent.platform)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {agent.testTime ? formatTime(agent.testTime) : '-'}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">{agent.passRate}</span>
                    </TableCell>
                    <TableCell>
                      <ScoreBadge score={agent.overallScore} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {agent.hasReport && (
                          <Link
                            href={`/tasks/${agent.id}/report`}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            测试报告
                          </Link>
                        )}
                        {agent.hasImprovementReport && (
                          <Link
                            href={`/tasks/${agent.id}/improvement`}
                            className="text-xs text-green-600 hover:underline"
                          >
                            改进报告
                          </Link>
                        )}
                        <Link
                          href={agent.casesLink}
                          className="text-xs text-gray-600 hover:underline"
                        >
                          用例详情
                        </Link>
                        <button
                          className="text-xs text-purple-600 hover:underline"
                          onClick={() => {
                            window.open(`/api/tasks/${agent.id}/report?format=md`, '_blank');
                          }}
                        >
                          导出
                        </button>
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={async () => {
                            if (!confirm(`确认删除「${agent.agentName}」的测试记录？数据将被永久删除。`)) return;
                            await fetch(`/api/tasks/${agent.id}?permanent=true`, { method: 'DELETE' });
                            fetchAgents();
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreBadge({ score }: { score: number | string }) {
  if (typeof score !== 'number') return <span className="text-gray-400">-</span>;

  let color = 'text-red-600 bg-red-50';
  if (score >= 80) color = 'text-green-600 bg-green-50';
  else if (score >= 60) color = 'text-yellow-600 bg-yellow-50';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-mono font-medium ${color}`}>
      {score}
    </span>
  );
}

function getPlatformName(platform: string): string {
  const names: Record<string, string> = {
    bailian: '百炼',
    coze_cn: 'Coze国内',
    coze_global: 'Coze国际',
  };
  return names[platform] || platform;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
