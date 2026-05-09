'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface TaskDetail {
  task: {
    id: string;
    agentName: string | null;
    botId: string;
    platform: string;
    status: string;
    totalCases: number | null;
    overallScore: number | null;
    createdAt: number;
    startedAt: number | null;
    finishedAt: number | null;
  };
  caseStats: {
    total: number;
    pending: number;
    running: number;
    done: number;
    failed: number;
  };
  verdictStats: {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
  };
}

export default function TaskMonitorPage() {
  const params = useParams();
  const taskId = params.id as string;

  const [data, setData] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTask();

    // 尝试 SSE 连接
    let eventSource: EventSource | null = null;
    let fallbackInterval: NodeJS.Timeout | null = null;

    function connectSSE() {
      eventSource = new EventSource(`/api/tasks/${taskId}/stream`);

      eventSource.addEventListener('progress', (event) => {
        const progress = JSON.parse(event.data);
        // SSE 连接成功，清理 fallback 轮询
        if (fallbackInterval) {
          clearInterval(fallbackInterval);
          fallbackInterval = null;
        }
        // 用 SSE 数据更新状态
        setData(prev => prev ? {
          ...prev,
          task: { ...prev.task, status: progress.taskStatus },
          caseStats: progress.caseStats,
          verdictStats: progress.verdictStats,
        } : prev);
      });

      eventSource.addEventListener('complete', (event) => {
        const result = JSON.parse(event.data);
        fetchTask(); // 完成时拉取完整数据
        eventSource?.close();
      });

      eventSource.addEventListener('error', () => {
        eventSource?.close();
        // SSE 断线，降级到轮询
        if (!fallbackInterval) {
          fallbackInterval = setInterval(fetchTask, 3000);
        }
        // 3 秒后尝试重连
        setTimeout(connectSSE, 3000);
      });
    }

    connectSSE();

    return () => {
      eventSource?.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [taskId]);

  async function fetchTask() {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('获取任务详情失败', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!confirm('确认取消此任务？已完成的用例仍可查看。')) return;
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    fetchTask();
  }

  async function handlePause() {
    await fetch(`/api/tasks/${taskId}/cases/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
    fetchTask();
  }

  async function handleResume() {
    await fetch(`/api/tasks/${taskId}/cases/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    });
    fetchTask();
  }

  async function handleStartExecution() {
    await fetch(`/api/tasks/${taskId}/execute`, { method: 'POST' });
    fetchTask();
  }

  if (loading) {
    return <div className="max-w-4xl mx-auto py-12 text-center text-gray-500">加载中...</div>;
  }

  if (!data) {
    return <div className="max-w-4xl mx-auto py-12 text-center text-gray-500">任务不存在</div>;
  }

  const { task, caseStats, verdictStats } = data;
  const totalDone = caseStats.done + caseStats.failed;
  const progressPct = caseStats.total > 0 ? Math.round((totalDone / caseStats.total) * 100) : 0;
  const isRunning = task.status === 'running' || task.status === 'generating';
  const isDone = task.status === 'done';
  const isReviewing = task.status === 'reviewing';

  // 预估剩余时间
  const elapsed = task.startedAt ? (Date.now() - task.startedAt) / 1000 : 0;
  const avgPerCase = totalDone > 0 ? elapsed / totalDone : 15;
  const remaining = Math.max(0, Math.round((caseStats.total - totalDone) * avgPerCase));

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* 任务概况 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl">
              {task.agentName || `任务 ${taskId.slice(0, 8)}`}
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              {getPlatformName(task.platform)} · {task.botId}
            </p>
          </div>
          <StatusBadge status={task.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 进度条 */}
          {(isRunning || isDone) && caseStats.total > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>执行进度</span>
                <span>{totalDone}/{caseStats.total} ({progressPct}%)</span>
              </div>
              <Progress value={progressPct} className="h-3" />
              {isRunning && remaining > 0 && (
                <p className="text-xs text-gray-500">
                  预计剩余 {formatDuration(remaining)}
                </p>
              )}
            </div>
          )}

          {/* 统计卡片 */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="总用例" value={caseStats.total} />
            <StatCard label="执行中" value={caseStats.running} color="blue" />
            <StatCard label="通过" value={verdictStats.passed} color="green" />
            <StatCard label="失败" value={verdictStats.failed} color="red" />
          </div>

          {/* 评分 */}
          {isDone && task.overallScore !== null && (
            <div className="p-4 bg-gray-50 rounded-lg text-center">
              <p className="text-sm text-gray-500">综合评分</p>
              <p className={`text-4xl font-bold mt-1 ${
                task.overallScore >= 80 ? 'text-green-600' :
                task.overallScore >= 60 ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {task.overallScore}
              </p>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-3">
            {isReviewing && (
              <Button onClick={handleStartExecution}>
                确认用例，开始执行
              </Button>
            )}
            {isRunning && (
              <>
                <Button variant="outline" onClick={handlePause}>
                  暂停
                </Button>
                <Button variant="destructive" onClick={handleCancel}>
                  取消任务
                </Button>
              </>
            )}
            {task.status === 'pending' && caseStats.total > 0 && (
              <Button onClick={handleResume}>
                恢复执行
              </Button>
            )}
            {isDone && (
              <>
                <Link href={`/tasks/${taskId}/cases`}>
                  <Button variant="outline">查看用例详情</Button>
                </Link>
                <Link href={`/tasks/${taskId}/report`}>
                  <Button variant="outline">查看测试报告</Button>
                </Link>
                <Link href={`/tasks/${taskId}/improvement`}>
                  <Button>查看改进报告</Button>
                </Link>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 生成中提示 */}
      {task.status === 'generating' && (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="animate-pulse text-lg mb-2">正在生成测试用例...</div>
            <p className="text-sm text-gray-500">
              系统正在分析智能体描述，生成多维度测试用例。预计 1-2 分钟。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorClass = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    red: 'text-red-600',
  }[color || ''] || 'text-gray-900';

  return (
    <div className="text-center p-3 bg-gray-50 rounded-lg">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string }> = {
    pending: { label: '等待中', color: 'bg-gray-100 text-gray-700' },
    generating: { label: '生成用例中', color: 'bg-blue-100 text-blue-700' },
    reviewing: { label: '待审核', color: 'bg-yellow-100 text-yellow-700' },
    running: { label: '执行中', color: 'bg-blue-100 text-blue-700' },
    done: { label: '已完成', color: 'bg-green-100 text-green-700' },
    cancelled: { label: '已取消', color: 'bg-gray-100 text-gray-700' },
    failed: { label: '失败', color: 'bg-red-100 text-red-700' },
  };
  const c = config[status] || { label: status, color: 'bg-gray-100 text-gray-700' };
  return <span className={`px-3 py-1 rounded-full text-sm font-medium ${c.color}`}>{c.label}</span>;
}

function getPlatformName(platform: string): string {
  const names: Record<string, string> = { bailian: '百炼', coze_cn: 'Coze国内', coze_global: 'Coze国际' };
  return names[platform] || platform;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}分${sec}秒`;
}
