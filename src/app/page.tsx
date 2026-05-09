'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export default function NewTaskPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [form, setForm] = useState({
    platform: 'bailian',
    apiKey: '',
    botId: '',
    agentName: '',
    expectedBehavior: '',
    industry: 'education',
    caseCount: 50,
    multiTurnRatio: 0.2,
    timeoutSec: 30,
    retryCount: 2,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // 前端校验
    if (!form.apiKey.trim()) { setError('请输入 API Key'); return; }
    if (!form.botId.trim()) { setError('请输入 App ID / Bot ID'); return; }
    if (form.expectedBehavior.length < 20) { setError('预期行为描述至少 20 字'); return; }

    // 用例数超过 100 需确认
    if (form.caseCount > 100) {
      const confirmed = window.confirm(`用例数为 ${form.caseCount}，预计耗时 ${Math.ceil(form.caseCount * 0.16)} 分钟以上，确认继续？`);
      if (!confirmed) return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || '创建失败');
      }

      const data = await res.json();
      router.push(`/tasks/${data.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const estimateTime = Math.ceil(form.caseCount * 0.16);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">新建测试任务</CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            配置智能体信息，自动生成测试用例并执行
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Step 1: 平台选择 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Step 1 · 选择平台
              </Label>
              <Select
                value={form.platform}
                onValueChange={(v) => v && setForm({ ...form, platform: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bailian">阿里百炼</SelectItem>
                  <SelectItem value="coze_cn">Coze 国内版</SelectItem>
                  <SelectItem value="coze_global">Coze 国际版</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Step 2: 凭证 */}
            <div className="space-y-4">
              <Label className="text-sm font-medium">
                Step 2 · 凭证信息
              </Label>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="apiKey" className="text-xs text-gray-500">API Key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder={form.platform === 'bailian' ? '百炼 API Key' : 'pat_xxx...'}
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="botId" className="text-xs text-gray-500">
                    {form.platform === 'bailian' ? 'App ID' : 'Bot ID'}
                  </Label>
                  <Input
                    id="botId"
                    placeholder={form.platform === 'bailian' ? '百炼应用 ID' : 'Bot ID'}
                    value={form.botId}
                    onChange={(e) => setForm({ ...form, botId: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="agentName" className="text-xs text-gray-500">
                    智能体名称（可选，不填则自动获取）
                  </Label>
                  <Input
                    id="agentName"
                    placeholder="例如：K12微戏剧创作助手"
                    value={form.agentName}
                    onChange={(e) => setForm({ ...form, agentName: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Step 3: 预期行为 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Step 3 · 预期行为描述
              </Label>
              <p className="text-xs text-gray-500">
                详细描述智能体应该做什么、怎么做、服务谁。描述越详细，生成的用例越精准。
              </p>
              <Textarea
                placeholder="例如：一个小学数学答疑助手，服务小学1-6年级学生。应该能解答四则运算、几何题、应用题。回答要用鼓励式语言，步骤清晰。应拒答成人话题、政治话题。"
                value={form.expectedBehavior}
                onChange={(e) => setForm({ ...form, expectedBehavior: e.target.value })}
                rows={5}
                className="resize-none"
              />
              <p className="text-xs text-gray-400 text-right">
                {form.expectedBehavior.length}/1000
              </p>
            </div>

            {/* Step 4: 行业 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Step 4 · 所属行业
              </Label>
              <Select
                value={form.industry}
                onValueChange={(v) => v && setForm({ ...form, industry: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">通用</SelectItem>
                  <SelectItem value="education">教育</SelectItem>
                  <SelectItem value="finance">金融</SelectItem>
                  <SelectItem value="medical">医疗</SelectItem>
                  <SelectItem value="customer_service">客服</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Step 5: 用例数量（主表单） */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Step 5 · 测试用例数量
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={10}
                  max={200}
                  value={form.caseCount}
                  onChange={(e) => setForm({ ...form, caseCount: parseInt(e.target.value) || 50 })}
                  className="w-24"
                />
                <span className="text-xs text-gray-500">
                  条（10-200），预计耗时约 {estimateTime} 分钟
                </span>
              </div>
            </div>

            {/* 高级设置 */}
            <div>
              <button
                type="button"
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? '▾ 收起高级设置' : '▸ 高级设置'}
              </button>

              {showAdvanced && (
                <div className="mt-3 p-4 bg-gray-50 rounded-lg space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label className="text-xs text-gray-500">多轮占比</Label>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={form.multiTurnRatio}
                        onChange={(e) => setForm({ ...form, multiTurnRatio: parseFloat(e.target.value) || 0.2 })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-500">超时(秒)</Label>
                      <Input
                        type="number"
                        min={5}
                        max={120}
                        value={form.timeoutSec}
                        onChange={(e) => setForm({ ...form, timeoutSec: parseInt(e.target.value) || 30 })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-500">重试次数</Label>
                      <Input
                        type="number"
                        min={0}
                        max={5}
                        value={form.retryCount}
                        onChange={(e) => setForm({ ...form, retryCount: parseInt(e.target.value) || 2 })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            {/* 提交按钮 */}
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? '正在创建...' : '开始生成测试用例'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
