'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* LLM 配置 */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">LLM 判分器配置</h3>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-gray-500">Base URL</Label>
                <Input
                  placeholder="https://api.deepseek.com"
                  defaultValue={process.env.NEXT_PUBLIC_LLM_BASE_URL || ''}
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500">API Key</Label>
                <Input type="password" placeholder="sk-..." />
              </div>
              <div>
                <Label className="text-xs text-gray-500">模型名称</Label>
                <Input placeholder="deepseek-chat" />
              </div>
            </div>
          </div>

          {/* 执行配置 */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">执行配置</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-gray-500">最大并发数</Label>
                <Input type="number" defaultValue={5} min={1} max={20} />
              </div>
              <div>
                <Label className="text-xs text-gray-500">默认超时(秒)</Label>
                <Input type="number" defaultValue={30} min={5} max={120} />
              </div>
            </div>
          </div>

          <Button className="w-full">保存设置</Button>
          <p className="text-xs text-gray-400 text-center">
            设置保存在浏览器本地，不会上传到服务器
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
