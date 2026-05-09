'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';

interface Task {
  id: string;
  agentName: string | null;
  botId: string;
  platform: string;
  status: string;
  totalCases: number | null;
  passedCases: number | null;
  failedCases: number | null;
  overallScore: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export default function TaskListPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [statusFilter]);

  async function fetchTasks() {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/tasks?${params}`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error('获取任务列表失败', err);
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
    if (selectedIds.size === tasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map(t => t.id)));
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
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-4">
            <CardTitle className="text-xl">测试任务列表</CardTitle>
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
           <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="running">正在运行</SelectItem>
              <SelectItem value="waiting">等待运行</SelectItem>
              <SelectItem value="completed">已完成</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12 text-gray-500">加载中...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">暂无任务</p>
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
                      checked={selectedIds.size === tasks.length && tasks.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </TableHead>
                  <TableHead>智能体</TableHead>
                  <TableHead>任务ID</TableHead>
                  <TableHead>平台</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>进度</TableHead>
                  <TableHead>评分</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(task.id)}
                        onChange={() => toggleSelect(task.id)}
                        className="rounded"
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {task.agentName || `${task.botId.slice(-8)}`}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-500">
                      {task.id.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{getPlatformName(task.platform)}</Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={task.status} />
                    </TableCell>
                    <TableCell>
                      <ProgressCell task={task} />
                    </TableCell>
                    <TableCell>
                      {task.overallScore !== null ? (
                        <span className={`font-mono ${task.overallScore >= 80 ? 'text-green-600' : task.overallScore >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {task.overallScore}
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {formatTime(task.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Link
                          href={`/tasks/${task.id}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          详情
                        </Link>
                        {task.status === 'done' && (
                          <Link
                            href={`/tasks/${task.id}/cases`}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            用例
                          </Link>
                        )}
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={async () => {
                            if (!confirm('确认删除此任务？所有关联数据将被永久删除。')) return;
                            await fetch(`/api/tasks/${task.id}?permanent=true`, { method: 'DELETE' });
                            fetchTasks();
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

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    pending: { label: '等待中', variant: 'outline' },
    generating: { label: '生成用例', variant: 'secondary' },
    reviewing: { label: '待审核', variant: 'secondary' },
    running: { label: '执行中', variant: 'default' },
    done: { label: '已完成', variant: 'default' },
    cancelled: { label: '已取消', variant: 'outline' },
    failed: { label: '失败', variant: 'destructive' },
  };
  const c = config[status] || { label: status, variant: 'outline' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function ProgressCell({ task }: { task: Task }) {
  if (task.status === 'done' && task.totalCases && task.passedCases !== null) {
    return (
      <span className="text-sm">
        {task.passedCases}/{task.totalCases} 通过
      </span>
    );
  }
  if (task.status === 'running' && task.totalCases) {
    const done = (task.passedCases || 0) + (task.failedCases || 0);
    const pct = Math.round((done / task.totalCases) * 100);
    return (
      <div className="flex items-center gap-2">
        <Progress value={pct} className="w-20 h-2" />
        <span className="text-xs text-gray-500">{pct}%</span>
      </div>
    );
  }
  return <span className="text-xs text-gray-400">-</span>;
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
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
