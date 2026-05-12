'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { PaginationControl } from '@/components/ui/pagination-control';
import { Loader2 } from 'lucide-react';

interface Task {
  id: string;
  agentName: string | null;
  botId: string;
  platform: string;
  status: string;
  configJson: string;
  totalCases: number | null;
  passedCases: number | null;
  failedCases: number | null;
  overallScore: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function TaskListPageWrapper() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-gray-500">加载中...</div>}>
      <TaskListPage />
    </Suspense>
  );
}

function TaskListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 从 URL 读取初始状态
  const initialPage = parseInt(searchParams.get('page') || '1');
  const initialStatus = searchParams.get('status') || 'all';

  const [tasks, setTasks] = useState<Task[]>([]);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(initialPage);
  const [pagination, setPagination] = useState<Pagination | null>(null);

  // 编辑 Dialog 状态
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // 同步 page 和 statusFilter 到 URL
  const updateURL = useCallback((newPage: number, newStatus: string) => {
    const params = new URLSearchParams();
    if (newPage > 1) params.set('page', String(newPage));
    if (newStatus !== 'all') params.set('status', newStatus);
    const query = params.toString();
    router.replace(`/tasks${query ? `?${query}` : ''}`, { scroll: false });
  }, [router]);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [statusFilter, page]);

  async function fetchTasks() {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('pageSize', '30');
      const res = await fetch(`/api/tasks?${params}`);
      const data = await res.json();
      setTasks(data.tasks || []);
      setPagination(data.pagination || null);
    } catch (err) {
      console.error('获取任务列表失败', err);
    } finally {
      setLoading(false);
    }
  }

  function handleStatusFilterChange(v: string) {
    setStatusFilter(v);
    setPage(1);
    updateURL(1, v);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    updateURL(newPage, statusFilter);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === tasks.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(tasks.map(t => t.id)));
  }

  // === 批量导出 ===
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

  // === 确认大纲 ===
  async function approveOutline(taskId: string) {
    await fetch(`/api/tasks/${taskId}/outline/approve`, { method: 'POST' });
    fetchTasks();
  }

  // === 确认用例执行 ===
  async function approveExecution(taskId: string) {
    await fetch(`/api/tasks/${taskId}/execute`, { method: 'POST' });
    fetchTasks();
  }

  // === 批量确认大纲 ===
  async function handleBatchApproveOutline() {
    const targets = tasks.filter(t => selectedIds.has(t.id) && t.status === 'outline_review');
    for (const t of targets) {
      await fetch(`/api/tasks/${t.id}/outline/approve`, { method: 'POST' });
    }
    setSelectedIds(new Set());
    fetchTasks();
  }

  // === 批量确认用例 ===
  async function handleBatchApproveExecution() {
    const targets = tasks.filter(t => selectedIds.has(t.id) && t.status === 'reviewing');
    for (const t of targets) {
      await fetch(`/api/tasks/${t.id}/execute`, { method: 'POST' });
    }
    setSelectedIds(new Set());
    fetchTasks();
  }

  // === 编辑任务 ===
  function openEditDialog(task: Task) {
    const config = JSON.parse(task.configJson);
    setEditingTask(task);
    setEditForm({
      platform: config.platform || 'bailian',
      apiKey: config.apiKey || '',
      botId: config.botId || '',
      agentName: config.agentName || '',
      expectedBehavior: config.expectedBehavior || '',
      industry: config.industry || 'general',
      caseCount: config.caseCount || 50,
      testContext: config.testContext || '',
      systemPrompt: config.systemPrompt || '',
    });
  }

  async function handleSaveEdit() {
    if (!editingTask || !editForm) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${editingTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditingTask(null);
        setEditForm(null);
        fetchTasks();
      } else {
        const data = await res.json();
        alert(data.message || '保存失败');
      }
    } catch (err) {
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  }

  // === 计算批量操作可见性 ===
  const selectedTasks = tasks.filter(t => selectedIds.has(t.id));
  const hasOutlineReview = selectedTasks.some(t => t.status === 'outline_review');
  const hasReviewing = selectedTasks.some(t => t.status === 'reviewing');

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-4">
            <CardTitle className="text-xl">测试任务列表</CardTitle>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-500">已选 {selectedIds.size} 项</span>
                <button
                  className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  onClick={handleBatchExport}
                  disabled={exporting}
                >
                  {exporting ? '导出中...' : '批量导出'}
                </button>
                {hasOutlineReview && (
                  <button
                    className="text-sm px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-700"
                    onClick={handleBatchApproveOutline}
                  >
                    批量确认大纲
                  </button>
                )}
                {hasReviewing && (
                  <button
                    className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                    onClick={handleBatchApproveExecution}
                  >
                    批量确认用例
                  </button>
                )}
              </div>
            )}
          </div>
          <Select value={statusFilter} onValueChange={(v) => v && handleStatusFilterChange(v)}>
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
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input type="checkbox" checked={selectedIds.size === tasks.length && tasks.length > 0} onChange={toggleSelectAll} className="rounded" />
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
                      <input type="checkbox" checked={selectedIds.has(task.id)} onChange={() => toggleSelect(task.id)} className="rounded" />
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
                      <div className="flex gap-1 flex-wrap">
                        <Link href={`/tasks/${task.id}`} className="text-xs text-blue-600 hover:underline">详情</Link>
                        {task.status === 'outline_review' && (
                          <>
                            <Link href={`/tasks/${task.id}/outline`} className="text-xs text-orange-600 hover:underline">大纲</Link>
                            <button className="text-xs text-green-600 hover:underline" onClick={() => approveOutline(task.id)}>确认大纲</button>
                          </>
                        )}
                        {task.status === 'reviewing' && (
                          <button className="text-xs text-green-600 hover:underline" onClick={() => approveExecution(task.id)}>确认用例</button>
                        )}
                        {(task.status === 'done' || task.status === 'running') && (
                          <Link href={`/tasks/${task.id}/cases`} className="text-xs text-blue-600 hover:underline">用例</Link>
                        )}
                        <button className="text-xs text-purple-600 hover:underline" onClick={() => openEditDialog(task)}>编辑</button>
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={async () => {
                            if (!confirm('确认删除此任务？')) return;
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
            {pagination && (
              <PaginationControl
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                onPageChange={handlePageChange}
              />
            )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 编辑任务 Dialog */}
      {editingTask && editForm && (
        <Dialog open onOpenChange={() => { setEditingTask(null); setEditForm(null); }}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>编辑任务 - {editingTask.agentName || editingTask.id.slice(0, 8)}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">平台</Label>
                  <Select value={editForm.platform} onValueChange={(v) => v && setEditForm({ ...editForm, platform: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bailian">阿里百炼</SelectItem>
                      <SelectItem value="coze_cn">Coze 国内版</SelectItem>
                      <SelectItem value="coze_global">Coze 国际版</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">行业</Label>
                  <Select value={editForm.industry} onValueChange={(v) => v && setEditForm({ ...editForm, industry: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">通用</SelectItem>
                      <SelectItem value="education">教育</SelectItem>
                      <SelectItem value="finance">金融</SelectItem>
                      <SelectItem value="medical">医疗</SelectItem>
                      <SelectItem value="customer_service">客服</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">API Key</Label>
                <Input type="password" value={editForm.apiKey} onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">App/Bot ID</Label>
                <Input value={editForm.botId} onChange={(e) => setEditForm({ ...editForm, botId: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">智能体名称</Label>
                <Input value={editForm.agentName} onChange={(e) => setEditForm({ ...editForm, agentName: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">预期行为描述</Label>
                <Textarea value={editForm.expectedBehavior} onChange={(e) => setEditForm({ ...editForm, expectedBehavior: e.target.value })} rows={3} />
              </div>
              <div>
                <Label className="text-xs">用例数量</Label>
                <Input type="number" min={10} max={200} value={editForm.caseCount} onChange={(e) => setEditForm({ ...editForm, caseCount: parseInt(e.target.value) || 50 })} />
              </div>
              <div>
                <Label className="text-xs">测试素材（可选）</Label>
                <Textarea value={editForm.testContext} onChange={(e) => setEditForm({ ...editForm, testContext: e.target.value })} rows={3} className="font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">System Prompt（可选）</Label>
                <Textarea value={editForm.systemPrompt} onChange={(e) => setEditForm({ ...editForm, systemPrompt: e.target.value })} rows={3} className="font-mono text-xs" />
              </div>
              <p className="text-xs text-orange-600">注意：保存后将重新分析智能体并生成测试大纲，之前的大纲和用例将被清除。</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditingTask(null); setEditForm(null); }}>取消</Button>
              <Button onClick={handleSaveEdit} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                保存并重新分析
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// === 状态 Badge ===
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    pending: { label: '等待中', variant: 'outline' },
    analyzing: { label: '分析中', variant: 'secondary' },
    outline_review: { label: '大纲审核', variant: 'secondary' },
    generating: { label: '生成用例', variant: 'secondary' },
    reviewing: { label: '待审核', variant: 'secondary' },
    running: { label: '执行中', variant: 'default' },
    completing: { label: '生成报告', variant: 'default' },
    done: { label: '已完成', variant: 'default' },
    cancelled: { label: '已取消', variant: 'outline' },
    failed: { label: '失败', variant: 'destructive' },
  };
  const c = config[status] || { label: status, variant: 'outline' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

// === 进度展示 ===
function ProgressCell({ task }: { task: Task }) {
  if (task.status === 'done' && task.totalCases && task.passedCases !== null) {
    return <span className="text-sm">{task.passedCases}/{task.totalCases} 通过</span>;
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
  if (task.status === 'analyzing') return <span className="flex items-center gap-1 text-xs text-blue-600"><Loader2 className="size-3 animate-spin" />分析中...</span>;
  if (task.status === 'outline_review') return <span className="text-xs text-orange-600">大纲待审核</span>;
  if (task.status === 'generating') return <span className="flex items-center gap-1 text-xs text-blue-600"><Loader2 className="size-3 animate-spin" />生成用例...</span>;
  if (task.status === 'completing') return <span className="flex items-center gap-1 text-xs text-blue-600"><Loader2 className="size-3 animate-spin" />生成报告...</span>;
  return <span className="text-xs text-gray-400">-</span>;
}

function getPlatformName(platform: string): string {
  const names: Record<string, string> = { bailian: '百炼', coze_cn: 'Coze国内', coze_global: 'Coze国际' };
  return names[platform] || platform;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
