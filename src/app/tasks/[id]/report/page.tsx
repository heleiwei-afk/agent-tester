'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

interface ReportData {
  taskId: string;
  config: any;
  agentName: string;
  cases: any[];
  verdicts: any[];
  startedAt: number;
  finishedAt: number;
}

export default function ReportPage() {
  const params = useParams();
  const taskId = params.id as string;

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReport();
  }, [taskId]);

  async function fetchReport() {
    try {
      const res = await fetch(`/api/tasks/${taskId}/report?format=json`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('获取报告失败', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="max-w-5xl mx-auto py-12 text-center text-gray-500">加载中...</div>;
  if (!data) return <div className="max-w-5xl mx-auto py-12 text-center text-gray-500">报告不存在</div>;

  const { cases, verdicts, config, agentName } = data;
  const totalCases = cases.length;
  const passedVerdicts = verdicts.filter((v: any) => v.pass);
  const failedVerdicts = verdicts.filter((v: any) => !v.pass);
  const passRate = totalCases > 0 ? Math.round((passedVerdicts.length / totalCases) * 100) : 0;
  const avgScore = verdicts.length > 0
    ? Math.round(verdicts.reduce((sum: number, v: any) => sum + v.score, 0) / verdicts.length)
    : 0;

  // 按维度统计
  const dimensions = ['alignment', 'industry', 'boundary', 'badcase', 'security'];
  const dimStats = dimensions.map(dim => {
    const dimCases = cases.filter((c: any) => c.dimension === dim);
    const dimVerdicts = verdicts.filter((v: any) => dimCases.some((c: any) => c.id === v.caseId));
    const passed = dimVerdicts.filter((v: any) => v.pass).length;
    const score = dimVerdicts.length > 0
      ? Math.round(dimVerdicts.reduce((s: number, v: any) => s + v.score, 0) / dimVerdicts.length)
      : 0;
    return { dim, total: dimCases.length, passed, score };
  }).filter(d => d.total > 0);

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* 顶部概览 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl">测试报告 · {agentName}</CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              {new Date(data.startedAt).toLocaleString('zh-CN')} · {config.platform}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadReport('md')}>
              下载 MD
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadReport('pdf')}>
              下载 PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadReport('json')}>
              下载 JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{avgScore}</p>
              <p className="text-sm text-gray-500">综合评分</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">{passRate}%</p>
              <p className="text-sm text-gray-500">通过率</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{totalCases}</p>
              <p className="text-sm text-gray-500">总用例</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-red-600">{failedVerdicts.length}</p>
              <p className="text-sm text-gray-500">失败用例</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 雷达图 + 维度得分 */}
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">维度得分雷达图</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <RadarChart dimStats={dimStats} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">各维度详情</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dimStats.map(d => (
                <div key={d.dim} className="flex items-center justify-between">
                  <span className="text-sm">{getDimensionName(d.dim)}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${d.score >= 80 ? 'bg-green-500' : d.score >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${d.score}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono w-12 text-right">{d.score}分</span>
                    <span className="text-xs text-gray-400">{d.passed}/{d.total}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 按维度分 Tab 展示 */}
      <Card>
        <Tabs defaultValue="all">
          <CardHeader>
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              {dimStats.map(d => (
                <TabsTrigger key={d.dim} value={d.dim}>
                  {getDimensionName(d.dim)} ({d.passed}/{d.total})
                </TabsTrigger>
              ))}
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="all">
              <CaseList cases={cases} verdicts={verdicts} />
            </TabsContent>
            {dimStats.map(d => (
              <TabsContent key={d.dim} value={d.dim}>
                <CaseList
                  cases={cases.filter((c: any) => c.dimension === d.dim)}
                  verdicts={verdicts}
                />
              </TabsContent>
            ))}
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );

  function downloadReport(format: string) {
    window.open(`/api/tasks/${taskId}/report?format=${format}`, '_blank');
  }
}

// 雷达图组件（纯 SVG）
function RadarChart({ dimStats }: { dimStats: Array<{ dim: string; score: number }> }) {
  const cx = 120, cy = 120, r = 80;
  const n = dimStats.length;
  if (n === 0) return <p className="text-gray-400">无数据</p>;

  const angleStep = (2 * Math.PI) / n;

  // 网格
  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const gridPaths = gridLevels.map(level => {
    const points = dimStats.map((_, i) => {
      const angle = -Math.PI / 2 + i * angleStep;
      return `${cx + r * level * Math.cos(angle)},${cy + r * level * Math.sin(angle)}`;
    }).join(' ');
    return <polygon key={level} points={points} fill="none" stroke="#e5e7eb" strokeWidth="1" />;
  });

  // 数据
  const dataPoints = dimStats.map((d, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const ratio = d.score / 100;
    return `${cx + r * ratio * Math.cos(angle)},${cy + r * ratio * Math.sin(angle)}`;
  }).join(' ');

  // 标签
  const labels = dimStats.map((d, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const x = cx + (r + 30) * Math.cos(angle);
    const y = cy + (r + 30) * Math.sin(angle);
    return (
      <text key={d.dim} x={x} y={y} textAnchor="middle" fontSize="11" fill="#6b7280">
        {getDimensionName(d.dim)}
      </text>
    );
  });

  return (
    <svg width="240" height="240" viewBox="0 0 240 240">
      {gridPaths}
      <polygon points={dataPoints} fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" strokeWidth="2" />
      {labels}
    </svg>
  );
}

// 用例列表组件
function CaseList({ cases, verdicts }: { cases: any[]; verdicts: any[] }) {
  const sortedCases = [...cases].sort((a, b) => {
    const va = verdicts.find((v: any) => v.caseId === a.id);
    const vb = verdicts.find((v: any) => v.caseId === b.id);
    // 失败的排前面
    if (va && vb) {
      if (!va.pass && vb.pass) return -1;
      if (va.pass && !vb.pass) return 1;
    }
    return 0;
  });

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {sortedCases.map(c => {
        const verdict = verdicts.find((v: any) => v.caseId === c.id);
        const lastUserMsg = (c.turns || []).filter((t: any) => t.role === 'user').pop()?.content || '';

        return (
          <div key={c.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-50">
            <span className={verdict?.pass ? 'text-green-500' : 'text-red-500'}>
              {verdict?.pass ? '✓' : '✗'}
            </span>
            <Badge variant="outline" className="text-xs shrink-0">
              {c.subType}
            </Badge>
            <span className="text-sm text-gray-600 truncate flex-1">
              {lastUserMsg.slice(0, 60)}
            </span>
            {verdict && (
              <span className="text-xs font-mono text-gray-400">{verdict.score}分</span>
            )}
            {verdict?.severity && (
              <SeverityBadge severity={verdict.severity} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-gray-100 text-gray-600',
  };
  return <span className={`text-xs px-1.5 py-0.5 rounded ${config[severity] || ''}`}>{severity}</span>;
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
