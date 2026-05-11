'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// ============================================================
// Types
// ============================================================

interface Template {
  id: string;
  type: string;
  dimension: string | null;
  industry: string | null;
  name: string;
  content: string;
  description: string | null;
  isActive: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

type TabType = 'dimension' | 'industry_rule' | 'good_case' | 'bad_case';

const TAB_CONFIG: { key: TabType; label: string }[] = [
  { key: 'dimension', label: '测试维度' },
  { key: 'industry_rule', label: '行业规则' },
  { key: 'good_case', label: 'Good Case' },
  { key: 'bad_case', label: 'Bad Case' },
];

const INDUSTRY_OPTIONS = [
  { key: 'education', label: '教育' },
  { key: 'finance', label: '金融' },
  { key: 'medical', label: '医疗' },
  { key: 'customer_service', label: '客服' },
];

const DIMENSION_OPTIONS = [
  { key: 'alignment', label: '预期效果' },
  { key: 'industry', label: '行业规范' },
  { key: 'boundary', label: '边界兜底' },
  { key: 'badcase', label: 'Bad Case' },
  { key: 'security', label: '安全性' },
];

// ============================================================
// Main Page
// ============================================================

export default function TemplatesPage() {
  const [activeTab, setActiveTab] = useState<TabType>('dimension');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // 编辑弹窗状态
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // 行业规则筛选
  const [selectedIndustry, setSelectedIndustry] = useState('education');
  // Good/Bad Case 维度筛选
  const [selectedDimension, setSelectedDimension] = useState('');

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
        if (data.templates.length > 0) setInitialized(true);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  async function handleInit() {
    setLoading(true);
    try {
      await fetch('/api/templates/init', { method: 'POST' });
      await fetchTemplates();
      setInitialized(true);
    } catch {}
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除此模板？')) return;
    await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    await fetchTemplates();
  }

  async function handleToggleActive(template: Template) {
    await fetch(`/api/templates/${template.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !template.isActive }),
    });
    await fetchTemplates();
  }

  function handleEdit(template: Template) {
    setEditingTemplate(template);
    setIsCreating(false);
    setShowEditor(true);
  }

  function handleCreate() {
    setEditingTemplate(null);
    setIsCreating(true);
    setShowEditor(true);
  }

  // 按 Tab 筛选模板
  const filteredTemplates = templates.filter(t => {
    if (t.type !== activeTab) return false;
    if (activeTab === 'industry_rule' && t.industry !== selectedIndustry) return false;
    if ((activeTab === 'good_case' || activeTab === 'bad_case') && selectedDimension && t.dimension !== selectedDimension) return false;
    return true;
  });

  // 维度 Tab 中隐藏系统 Prompt（以 _ 开头的 dimension）
  const visibleDimensions = activeTab === 'dimension'
    ? filteredTemplates.filter(t => !t.dimension?.startsWith('_'))
    : filteredTemplates;
  const systemPrompts = activeTab === 'dimension'
    ? filteredTemplates.filter(t => t.dimension?.startsWith('_'))
    : [];

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse text-center py-12">加载中...</div>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="text-xl font-semibold mb-4">模板管理</h2>
            <p className="text-gray-500 mb-6">
              首次使用需要初始化默认模板数据（测试维度 Prompt、行业规则、示例用例）
            </p>
            <Button onClick={handleInit}>初始化默认模板</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">模板管理</h1>
        <Button onClick={handleCreate}>+ 新增</Button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        {TAB_CONFIG.map(tab => (
          <button
            key={tab.key}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span className="ml-1 text-xs text-gray-400">
              ({templates.filter(t => t.type === tab.key).length})
            </span>
          </button>
        ))}
      </div>

      {/* 筛选器 */}
      {activeTab === 'industry_rule' && (
        <div className="flex gap-2">
          {INDUSTRY_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`px-3 py-1 rounded text-sm ${
                selectedIndustry === opt.key
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
              onClick={() => setSelectedIndustry(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {(activeTab === 'good_case' || activeTab === 'bad_case') && (
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 rounded text-sm ${
              !selectedDimension ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-50 text-gray-600'
            }`}
            onClick={() => setSelectedDimension('')}
          >
            全部
          </button>
          {DIMENSION_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`px-3 py-1 rounded text-sm ${
                selectedDimension === opt.key
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
              onClick={() => setSelectedDimension(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* 模板列表 */}
      <div className="space-y-3">
        {activeTab === 'dimension' && (
          <>
            {visibleDimensions.map(t => (
              <DimensionCard key={t.id} template={t} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggleActive} />
            ))}
            {systemPrompts.length > 0 && (
              <>
                <h3 className="text-sm font-medium text-gray-500 mt-6 pt-4 border-t">系统 Prompt</h3>
                {systemPrompts.map(t => (
                  <DimensionCard key={t.id} template={t} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggleActive} />
                ))}
              </>
            )}
          </>
        )}

        {activeTab === 'industry_rule' && filteredTemplates.map(t => (
          <RuleCard key={t.id} template={t} onEdit={handleEdit} onDelete={handleDelete} />
        ))}

        {(activeTab === 'good_case' || activeTab === 'bad_case') && filteredTemplates.map(t => (
          <CaseCard key={t.id} template={t} type={activeTab} onEdit={handleEdit} onDelete={handleDelete} />
        ))}

        {filteredTemplates.length === 0 && (
          <div className="text-center py-8 text-gray-400">暂无数据</div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {showEditor && (
        <TemplateEditor
          template={editingTemplate}
          isCreating={isCreating}
          activeTab={activeTab}
          onClose={() => setShowEditor(false)}
          onSaved={() => { setShowEditor(false); fetchTemplates(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// 维度卡片
// ============================================================

function DimensionCard({ template, onEdit, onDelete, onToggle }: {
  template: Template;
  onEdit: (t: Template) => void;
  onDelete: (id: string) => void;
  onToggle: (t: Template) => void;
}) {
  const preview = template.content.slice(0, 120).replace(/\n/g, ' ');

  return (
    <Card className={`${!template.isActive ? 'opacity-50' : ''}`}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">{template.name}</span>
              {template.dimension && !template.dimension.startsWith('_') && (
                <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded">{template.dimension}</span>
              )}
              {!template.isActive && (
                <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">已禁用</span>
              )}
            </div>
            {template.description && (
              <p className="text-sm text-gray-500 mb-1">{template.description}</p>
            )}
            <p className="text-xs text-gray-400 font-mono truncate">{preview}...</p>
          </div>
          <div className="flex gap-1 shrink-0">
            <button className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200" onClick={() => onEdit(template)}>编辑</button>
            <button className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200" onClick={() => onToggle(template)}>
              {template.isActive ? '禁用' : '启用'}
            </button>
            {template.dimension?.startsWith('_') || ['alignment', 'industry', 'boundary', 'badcase', 'security'].includes(template.dimension || '')
              ? null
              : <button className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100" onClick={() => onDelete(template.id)}>删除</button>
            }
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 行业规则卡片
// ============================================================

function RuleCard({ template, onEdit, onDelete }: {
  template: Template;
  onEdit: (t: Template) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-white border rounded-lg">
      <span className="flex-1 text-sm">{template.content}</span>
      <button className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200" onClick={() => onEdit(template)}>编辑</button>
      <button className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100" onClick={() => onDelete(template.id)}>删除</button>
    </div>
  );
}

// ============================================================
// Good/Bad Case 卡片
// ============================================================

function CaseCard({ template, type, onEdit, onDelete }: {
  template: Template;
  type: 'good_case' | 'bad_case';
  onEdit: (t: Template) => void;
  onDelete: (id: string) => void;
}) {
  let parsed: any = {};
  try { parsed = JSON.parse(template.content); } catch {}

  const dimLabel = DIMENSION_OPTIONS.find(d => d.key === template.dimension)?.label || template.dimension;

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 rounded">{dimLabel}</span>
              <span className="font-medium text-sm">{template.name}</span>
            </div>
            {parsed.turns && (
              <p className="text-sm text-gray-600 mb-1">
                <span className="text-gray-400">用户：</span>
                {parsed.turns[0]?.content?.slice(0, 80)}
              </p>
            )}
            {type === 'good_case' && parsed.expectation && (
              <p className="text-xs text-gray-500">
                <span className="text-gray-400">期望：</span>{parsed.expectation}
              </p>
            )}
            {type === 'bad_case' && parsed.reason && (
              <p className="text-xs text-red-500">
                <span className="text-gray-400">问题：</span>{parsed.reason}
              </p>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <button className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200" onClick={() => onEdit(template)}>编辑</button>
            <button className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100" onClick={() => onDelete(template.id)}>删除</button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 编辑弹窗
// ============================================================

function TemplateEditor({ template, isCreating, activeTab, onClose, onSaved }: {
  template: Template | null;
  isCreating: boolean;
  activeTab: TabType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name || '');
  const [content, setContent] = useState(template?.content || '');
  const [description, setDescription] = useState(template?.description || '');
  const [dimension, setDimension] = useState(template?.dimension || '');
  const [industry, setIndustry] = useState(template?.industry || 'education');
  const [saving, setSaving] = useState(false);

  // Good/Bad Case 结构化编辑
  const [caseUserInput, setCaseUserInput] = useState('');
  const [caseExpectation, setCaseExpectation] = useState('');
  const [caseCriteria, setCaseCriteria] = useState('');
  const [caseReason, setCaseReason] = useState('');

  useEffect(() => {
    if ((activeTab === 'good_case' || activeTab === 'bad_case') && template) {
      try {
        const parsed = JSON.parse(template.content);
        setCaseUserInput(parsed.turns?.[0]?.content || '');
        setCaseExpectation(parsed.expectation || '');
        setCaseCriteria((parsed.passCriteria || []).join('\n'));
        setCaseReason(parsed.reason || '');
      } catch {}
    }
  }, [template, activeTab]);

  async function handleSave() {
    setSaving(true);

    let finalContent = content;

    // Good/Bad Case 需要组装 JSON
    if (activeTab === 'good_case') {
      finalContent = JSON.stringify({
        turns: [{ role: 'user', content: caseUserInput }],
        expectation: caseExpectation,
        passCriteria: caseCriteria.split('\n').filter(Boolean),
      });
    } else if (activeTab === 'bad_case') {
      finalContent = JSON.stringify({
        turns: [{ role: 'user', content: caseUserInput }],
        reason: caseReason,
      });
    }

    try {
      if (isCreating) {
        await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: activeTab,
            name,
            content: finalContent,
            description: description || null,
            dimension: dimension || null,
            industry: activeTab === 'industry_rule' ? industry : null,
          }),
        });
      } else if (template) {
        await fetch(`/api/templates/${template.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            content: finalContent,
            description: description || null,
            dimension: dimension || null,
            industry: activeTab === 'industry_rule' ? industry : null,
          }),
        });
      }
      onSaved();
    } catch {}
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {isCreating ? '新增' : '编辑'}{TAB_CONFIG.find(t => t.key === activeTab)?.label}
            </h2>
            <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={onClose}>×</button>
          </div>

          {/* 名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
            <input
              className="w-full px-3 py-2 border rounded-lg text-sm"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="模板名称"
            />
          </div>

          {/* 维度选择（Good/Bad Case + 新建维度时） */}
          {(activeTab === 'good_case' || activeTab === 'bad_case' || (activeTab === 'dimension' && isCreating)) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">关联维度</label>
              {isCreating && activeTab === 'dimension' ? (
                <input
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  value={dimension}
                  onChange={e => setDimension(e.target.value)}
                  placeholder="维度 key（英文，如 multilingual）"
                />
              ) : (
                <select
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  value={dimension}
                  onChange={e => setDimension(e.target.value)}
                >
                  <option value="">请选择</option>
                  {DIMENSION_OPTIONS.map(d => (
                    <option key={d.key} value={d.key}>{d.label}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* 行业选择 */}
          {activeTab === 'industry_rule' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">所属行业</label>
              <select
                className="w-full px-3 py-2 border rounded-lg text-sm"
                value={industry}
                onChange={e => setIndustry(e.target.value)}
              >
                {INDUSTRY_OPTIONS.map(opt => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* 内容编辑 - 维度 Prompt / 行业规则 */}
          {(activeTab === 'dimension' || activeTab === 'industry_rule') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {activeTab === 'dimension' ? 'Prompt 内容' : '规则内容'}
              </label>
              <textarea
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono min-h-[300px] resize-y"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={activeTab === 'dimension'
                  ? '输入 Prompt 模板，可使用 {expectedBehavior}, {industry}, {capabilities} 等变量'
                  : '输入规则内容'
                }
              />
              {activeTab === 'dimension' && (
                <p className="text-xs text-gray-400 mt-1">
                  可用变量：{'{expectedBehavior}'}, {'{industry}'}, {'{capabilities}'}, {'{userProfile}'}, {'{multiTurnRatio}'}, {'{boundaries}'}, {'{industryRules}'}
                </p>
              )}
            </div>
          )}

          {/* Good Case 结构化编辑 */}
          {activeTab === 'good_case' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">用户输入</label>
                <textarea
                  className="w-full px-3 py-2 border rounded-lg text-sm min-h-[80px]"
                  value={caseUserInput}
                  onChange={e => setCaseUserInput(e.target.value)}
                  placeholder="模拟用户的提问"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">期望行为</label>
                <textarea
                  className="w-full px-3 py-2 border rounded-lg text-sm min-h-[60px]"
                  value={caseExpectation}
                  onChange={e => setCaseExpectation(e.target.value)}
                  placeholder="智能体应该如何回应"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">通过标准（每行一条）</label>
                <textarea
                  className="w-full px-3 py-2 border rounded-lg text-sm min-h-[80px]"
                  value={caseCriteria}
                  onChange={e => setCaseCriteria(e.target.value)}
                  placeholder={'包含具体数字\n不包含"我无法"\n语气友好'}
                />
              </div>
            </>
          )}

          {/* Bad Case 结构化编辑 */}
          {activeTab === 'bad_case' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">用户输入</label>
                <textarea
                  className="w-full px-3 py-2 border rounded-lg text-sm min-h-[80px]"
                  value={caseUserInput}
                  onChange={e => setCaseUserInput(e.target.value)}
                  placeholder="模拟用户的提问"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">失败原因</label>
                <textarea
                  className="w-full px-3 py-2 border rounded-lg text-sm min-h-[80px]"
                  value={caseReason}
                  onChange={e => setCaseReason(e.target.value)}
                  placeholder="描述为什么这是一个 Bad Case（智能体做错了什么）"
                />
              </div>
            </>
          )}

          {/* 描述（维度时显示） */}
          {activeTab === 'dimension' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">描述说明</label>
              <input
                className="w-full px-3 py-2 border rounded-lg text-sm"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="简要描述此维度的测试目标"
              />
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSave} disabled={saving || !name}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
