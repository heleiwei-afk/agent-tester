'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ChevronDown, ChevronRight, Edit, Trash2, Plus, Loader2 } from 'lucide-react';

interface TestOutline {
  agentAnalysis: {
    coreValue: string;
    targetUsers: string[];
    keyCapabilities: string[];
    riskAreas: string[];
  };
  testGoals: TestGoal[];
}

interface TestGoal {
  id: string;
  name: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  rationale: string;
  scenarios: TestScenario[];
}

interface TestScenario {
  id: string;
  name: string;
  userContext: string;
  expectedOutcome: string;
  testPoints: TestPoint[];
}

interface TestPoint {
  id: string;
  description: string;
  testType: 'positive' | 'negative' | 'boundary' | 'stress';
  estimatedCaseCount: number;
  passCriteria: string[];
}

const priorityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-gray-100 text-gray-800 border-gray-200',
};

const priorityLabels: Record<string, string> = {
  critical: '关键',
  high: '高',
  medium: '中',
  low: '低',
};

const testTypeLabels: Record<string, string> = {
  positive: '正向',
  negative: '反向',
  boundary: '边界',
  stress: '压力',
};

export default function OutlinePage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [outline, setOutline] = useState<TestOutline | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());

  // 编辑对话框
  const [editDialog, setEditDialog] = useState<{
    type: 'goal' | 'scenario' | 'point';
    data: any;
    goalId?: string;
    scenarioId?: string;
  } | null>(null);

  useEffect(() => {
    fetchOutline();
  }, [taskId]);

  const fetchOutline = async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/outline`);
      if (res.ok) {
        const data = await res.json();
        setOutline(data.outline);
        const goalIds = new Set<string>(data.outline.testGoals.map((g: TestGoal) => g.id));
        const scenarioIds = new Set<string>(
          data.outline.testGoals.flatMap((g: TestGoal) => g.scenarios.map((s: TestScenario) => s.id))
        );
        setExpandedGoals(goalIds);
        setExpandedScenarios(scenarioIds);
      }
    } catch (error) {
      console.error('获取大纲失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveOutline = async () => {
    if (!outline) return;
    setSaving(true);
    try {
      await fetch(`/api/tasks/${taskId}/outline`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outline }),
      });
    } catch (error) {
      console.error('保存失败:', error);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const approveOutline = async () => {
    await saveOutline();
    setApproving(true);
    try {
      await fetch(`/api/tasks/${taskId}/outline/approve`, { method: 'POST' });
      router.push(`/tasks/${taskId}/cases`);
    } catch (error) {
      console.error('批准失败:', error);
      alert('批准失败');
    } finally {
      setApproving(false);
    }
  };

  const regenerateOutline = async () => {
    if (!confirm('确定要重新生成大纲吗？当前的修改将丢失。')) return;
    setRegenerating(true);
    setLoading(true);
    try {
      await fetch(`/api/tasks/${taskId}/outline/generate`, { method: 'POST' });
      const interval = setInterval(async () => {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.task?.status === 'outline_review') {
            clearInterval(interval);
            await fetchOutline();
            setRegenerating(false);
            setLoading(false);
          }
        }
      }, 2000);
    } catch (error) {
      console.error('重新生成失败:', error);
      alert('重新生成失败');
      setRegenerating(false);
      setLoading(false);
    }
  };

  const toggleGoal = (goalId: string) => {
    const s = new Set(expandedGoals);
    s.has(goalId) ? s.delete(goalId) : s.add(goalId);
    setExpandedGoals(s);
  };

  const toggleScenario = (scenarioId: string) => {
    const s = new Set(expandedScenarios);
    s.has(scenarioId) ? s.delete(scenarioId) : s.add(scenarioId);
    setExpandedScenarios(s);
  };

  const calculateTotalCases = () => {
    if (!outline) return 0;
    return outline.testGoals.reduce(
      (total, goal) =>
        total + goal.scenarios.reduce(
          (sum, scenario) =>
            sum + scenario.testPoints.reduce((s, point) => s + point.estimatedCaseCount, 0),
          0
        ),
      0
    );
  };

  // ===== CRUD 操作 =====

  const deleteGoal = (goalId: string) => {
    if (!outline || !confirm('确定删除此测试目标？')) return;
    setOutline({ ...outline, testGoals: outline.testGoals.filter((g) => g.id !== goalId) });
  };

  const deleteScenario = (goalId: string, scenarioId: string) => {
    if (!outline || !confirm('确定删除此测试场景？')) return;
    setOutline({
      ...outline,
      testGoals: outline.testGoals.map((g) =>
        g.id === goalId ? { ...g, scenarios: g.scenarios.filter((s) => s.id !== scenarioId) } : g
      ),
    });
  };

  const deletePoint = (goalId: string, scenarioId: string, pointId: string) => {
    if (!outline || !confirm('确定删除此测试点？')) return;
    setOutline({
      ...outline,
      testGoals: outline.testGoals.map((g) =>
        g.id === goalId
          ? {
              ...g,
              scenarios: g.scenarios.map((s) =>
                s.id === scenarioId
                  ? { ...s, testPoints: s.testPoints.filter((p) => p.id !== pointId) }
                  : s
              ),
            }
          : g
      ),
    });
  };

  const addGoal = () => {
    if (!outline) return;
    const newGoal: TestGoal = {
      id: `goal-${Date.now()}`,
      name: '新测试目标',
      priority: 'medium',
      rationale: '',
      scenarios: [],
    };
    setOutline({ ...outline, testGoals: [...outline.testGoals, newGoal] });
    setExpandedGoals(new Set([...expandedGoals, newGoal.id]));
    setEditDialog({ type: 'goal', data: newGoal });
  };

  const addScenario = (goalId: string) => {
    if (!outline) return;
    const newScenario: TestScenario = {
      id: `scenario-${Date.now()}`,
      name: '新测试场景',
      userContext: '',
      expectedOutcome: '',
      testPoints: [],
    };
    setOutline({
      ...outline,
      testGoals: outline.testGoals.map((g) =>
        g.id === goalId ? { ...g, scenarios: [...g.scenarios, newScenario] } : g
      ),
    });
    setExpandedScenarios(new Set([...expandedScenarios, newScenario.id]));
    setEditDialog({ type: 'scenario', data: newScenario, goalId });
  };

  const addPoint = (goalId: string, scenarioId: string) => {
    if (!outline) return;
    const newPoint: TestPoint = {
      id: `point-${Date.now()}`,
      description: '新测试点',
      testType: 'positive',
      estimatedCaseCount: 2,
      passCriteria: [],
    };
    setOutline({
      ...outline,
      testGoals: outline.testGoals.map((g) =>
        g.id === goalId
          ? {
              ...g,
              scenarios: g.scenarios.map((s) =>
                s.id === scenarioId ? { ...s, testPoints: [...s.testPoints, newPoint] } : s
              ),
            }
          : g
      ),
    });
    setEditDialog({ type: 'point', data: newPoint, goalId, scenarioId });
  };

  const handleEditSave = (updatedData: any) => {
    if (!outline || !editDialog) return;

    if (editDialog.type === 'goal') {
      setOutline({
        ...outline,
        testGoals: outline.testGoals.map((g) =>
          g.id === updatedData.id ? { ...g, ...updatedData } : g
        ),
      });
    } else if (editDialog.type === 'scenario' && editDialog.goalId) {
      setOutline({
        ...outline,
        testGoals: outline.testGoals.map((g) =>
          g.id === editDialog.goalId
            ? { ...g, scenarios: g.scenarios.map((s) => (s.id === updatedData.id ? { ...s, ...updatedData } : s)) }
            : g
        ),
      });
    } else if (editDialog.type === 'point' && editDialog.goalId && editDialog.scenarioId) {
      setOutline({
        ...outline,
        testGoals: outline.testGoals.map((g) =>
          g.id === editDialog.goalId
            ? {
                ...g,
                scenarios: g.scenarios.map((s) =>
                  s.id === editDialog.scenarioId
                    ? { ...s, testPoints: s.testPoints.map((p) => (p.id === updatedData.id ? { ...p, ...updatedData } : p)) }
                    : s
                ),
              }
            : g
        ),
      });
    }

    setEditDialog(null);
  };

  // ===== 渲染 =====

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        <span className="ml-3 text-gray-500">
          {regenerating ? '正在重新生成大纲...' : '加载中...'}
        </span>
      </div>
    );
  }

  if (!outline) {
    return (
      <div className="text-center py-12 text-gray-500">
        大纲尚未生成，请等待分析完成。
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">测试大纲审核</h1>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          预计生成 <span className="font-bold text-gray-900">{calculateTotalCases()}</span> 条用例
        </div>
      </div>

      {/* 智能体分析卡片 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">智能体分析</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <span className="text-sm font-medium text-gray-500">核心价值：</span>
            <span className="text-sm">{outline.agentAnalysis.coreValue}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-500">目标用户：</span>
            <span className="text-sm">{outline.agentAnalysis.targetUsers.join('、')}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-500">关键能力：</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {outline.agentAnalysis.keyCapabilities.map((cap, i) => (
                <Badge key={i} variant="secondary" className="text-xs">{cap}</Badge>
              ))}
            </div>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-500">高风险区域：</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {outline.agentAnalysis.riskAreas.map((risk, i) => (
                <Badge key={i} variant="outline" className="text-xs text-red-600 border-red-200">{risk}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 测试目标列表 */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">测试目标</h2>

        {outline.testGoals.map((goal) => (
          <Card key={goal.id} className="overflow-hidden">
            {/* Goal Header */}
            <div
              className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-gray-50"
              onClick={() => toggleGoal(goal.id)}
            >
              {expandedGoals.has(goal.id) ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
              <span className="font-medium flex-1">{goal.name}</span>
              <Badge className={`text-xs ${priorityColors[goal.priority]}`}>
                {priorityLabels[goal.priority]}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); setEditDialog({ type: 'goal', data: goal }); }}
              >
                <Edit className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); deleteGoal(goal.id); }}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </Button>
            </div>

            {/* Goal Content */}
            {expandedGoals.has(goal.id) && (
              <div className="px-4 pb-4 border-t">
                <p className="text-xs text-gray-500 mt-2 mb-3">{goal.rationale}</p>

                {/* Scenarios */}
                <div className="space-y-2 ml-4">
                  {goal.scenarios.map((scenario) => (
                    <div key={scenario.id} className="border rounded-lg">
                      {/* Scenario Header */}
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleScenario(scenario.id)}
                      >
                        {expandedScenarios.has(scenario.id) ? (
                          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                        )}
                        <span className="text-sm font-medium flex-1">{scenario.name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditDialog({ type: 'scenario', data: scenario, goalId: goal.id });
                          }}
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => { e.stopPropagation(); deleteScenario(goal.id, scenario.id); }}
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </Button>
                      </div>

                      {/* Scenario Content */}
                      {expandedScenarios.has(scenario.id) && (
                        <div className="px-3 pb-3 border-t">
                          <div className="text-xs text-gray-500 mt-2 space-y-1">
                            <div><span className="font-medium">用户场景：</span>{scenario.userContext}</div>
                            <div><span className="font-medium">期望结果：</span>{scenario.expectedOutcome}</div>
                          </div>

                          {/* Test Points */}
                          <div className="mt-2 space-y-1 ml-4">
                            {scenario.testPoints.map((point) => (
                              <div
                                key={point.id}
                                className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-gray-50 group"
                              >
                                <span className="text-gray-400">•</span>
                                <span className="flex-1">{point.description}</span>
                                <Badge variant="outline" className="text-[10px] px-1">
                                  {testTypeLabels[point.testType]}
                                </Badge>
                                <span className="text-gray-400">{point.estimatedCaseCount}条</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
                                  onClick={() =>
                                    setEditDialog({
                                      type: 'point',
                                      data: point,
                                      goalId: goal.id,
                                      scenarioId: scenario.id,
                                    })
                                  }
                                >
                                  <Edit className="w-2.5 h-2.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
                                  onClick={() => deletePoint(goal.id, scenario.id, point.id)}
                                >
                                  <Trash2 className="w-2.5 h-2.5 text-red-500" />
                                </Button>
                              </div>
                            ))}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-blue-600 h-6"
                              onClick={() => addPoint(goal.id, scenario.id)}
                            >
                              <Plus className="w-3 h-3 mr-1" /> 添加测试点
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-blue-600"
                    onClick={() => addScenario(goal.id)}
                  >
                    <Plus className="w-3 h-3 mr-1" /> 添加测试场景
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}

        <Button variant="outline" className="w-full" onClick={addGoal}>
          <Plus className="w-4 h-4 mr-2" /> 添加测试目标
        </Button>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-between pt-4 border-t">
        <Button variant="outline" onClick={regenerateOutline} disabled={regenerating}>
          {regenerating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          重新生成大纲
        </Button>
        <div className="flex gap-3">
          <Button variant="outline" onClick={saveOutline} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            保存草稿
          </Button>
          <Button onClick={approveOutline} disabled={approving}>
            {approving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            确认并生成用例
          </Button>
        </div>
      </div>

      {/* 编辑对话框 */}
      {editDialog && (
        <EditDialog
          type={editDialog.type}
          data={editDialog.data}
          onSave={handleEditSave}
          onClose={() => setEditDialog(null)}
        />
      )}
    </div>
  );
}

// ===== 编辑对话框组件 =====

function EditDialog({
  type,
  data,
  onSave,
  onClose,
}: {
  type: 'goal' | 'scenario' | 'point';
  data: any;
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({ ...data });

  const handleSave = () => {
    onSave(formData);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {type === 'goal' && '编辑测试目标'}
            {type === 'scenario' && '编辑测试场景'}
            {type === 'point' && '编辑测试点'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {type === 'goal' && (
            <>
              <div>
                <Label>名称</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <Label>优先级</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(v) => setFormData({ ...formData, priority: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">关键</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>理由</Label>
                <Textarea
                  value={formData.rationale}
                  onChange={(e) => setFormData({ ...formData, rationale: e.target.value })}
                  rows={3}
                />
              </div>
            </>
          )}

          {type === 'scenario' && (
            <>
              <div>
                <Label>名称</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <Label>用户场景</Label>
                <Textarea
                  value={formData.userContext}
                  onChange={(e) => setFormData({ ...formData, userContext: e.target.value })}
                  rows={2}
                />
              </div>
              <div>
                <Label>期望结果</Label>
                <Textarea
                  value={formData.expectedOutcome}
                  onChange={(e) => setFormData({ ...formData, expectedOutcome: e.target.value })}
                  rows={2}
                />
              </div>
            </>
          )}

          {type === 'point' && (
            <>
              <div>
                <Label>描述</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div>
                <Label>测试类型</Label>
                <Select
                  value={formData.testType}
                  onValueChange={(v) => setFormData({ ...formData, testType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positive">正向</SelectItem>
                    <SelectItem value="negative">反向</SelectItem>
                    <SelectItem value="boundary">边界</SelectItem>
                    <SelectItem value="stress">压力</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>预计用例数</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={formData.estimatedCaseCount}
                  onChange={(e) =>
                    setFormData({ ...formData, estimatedCaseCount: parseInt(e.target.value) || 1 })
                  }
                />
              </div>
              <div>
                <Label>通过标准（每行一条）</Label>
                <Textarea
                  value={(formData.passCriteria || []).join('\n')}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      passCriteria: e.target.value.split('\n').filter((s: string) => s.trim()),
                    })
                  }
                  rows={3}
                  placeholder="每行一条通过标准"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
