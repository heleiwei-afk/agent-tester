import type { AgentAdapter } from './base';
import { AdapterError } from './base';
import type { AdapterResponse, ChatMessage } from '../types';
import { createTaskLogger } from '../logger';
import { v4 as uuid } from 'uuid';

const logger = createTaskLogger('bailian-adapter');

const BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com';

/**
 * 阿里百炼平台适配器（应用模式）
 * 
 * 端点：POST /api/v1/apps/{app_id}/completion
 * 鉴权：Authorization: Bearer {api_key}
 * 多轮：通过 session_id 维持上下文
 * 流式：X-DashScope-SSE: enable
 */
export class BailianAdapter implements AgentAdapter {
  readonly platform = 'bailian' as const;
  private apiKey: string;
  private appId: string;

  constructor(apiKey: string, appId: string) {
    this.apiKey = apiKey.trim();
    this.appId = appId.trim();
  }

  /**
   * 校验凭证：尝试调用应用信息接口
   */
  async validate(): Promise<void> {
    try {
      const response = await fetch(
        `${BAILIAN_BASE_URL}/api/v1/apps/${this.appId}/completion`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: { prompt: '你好' },
            parameters: {},
          }),
        }
      );

      if (response.status === 401 || response.status === 403) {
        const body = await response.text();
        throw new AdapterError('auth_failed', response.status, body);
      }

      if (response.status === 404) {
        const body = await response.text();
        throw new AdapterError('not_found', response.status, body);
      }

      // 其他错误也可能是正常的（比如参数不对），但至少鉴权通过了
      if (response.status >= 500) {
        const body = await response.text();
        throw new AdapterError('server_error', response.status, body);
      }
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError('unknown', 0, (error as Error).message);
    }
  }

  /**
   * 从百炼 API 获取应用名称
   * 通过调用一次对话，从智能体的自我介绍中提取名称
   */
  async getAgentName(): Promise<string> {
    try {
      const response = await fetch(
        `${BAILIAN_BASE_URL}/api/v1/apps/${this.appId}/completion`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: { prompt: '你是谁？请用一句话介绍自己的名字和功能。' },
            parameters: {},
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const text = data?.output?.text || data?.output?.choices?.[0]?.message?.content || '';
        if (text) {
          // 尝试提取"我是XXX"模式
          const nameMatch = text.match(/我是(.{2,20}?)[，,。.！!？?\n]/);
          if (nameMatch) return nameMatch[1].trim();
          // 尝试提取"我叫XXX"模式
          const nameMatch2 = text.match(/我叫(.{2,20}?)[，,。.！!？?\n]/);
          if (nameMatch2) return nameMatch2[1].trim();
          // 取前30字（去掉 emoji 和空白）
          const cleaned = text.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
          if (cleaned.length > 0) {
            return cleaned.slice(0, 30);
          }
        }
      }
      return `百炼应用-${this.appId.slice(-6)}`;
    } catch {
      return `百炼应用-${this.appId.slice(-6)}`;
    }
  }

  /**
   * 创建会话（百炼通过 session_id 维持多轮）
   */
  async createConversation(): Promise<string> {
    return uuid();
  }

  /**
   * 发送消息并获取响应
   */
  async invoke(params: {
    conversationId: string;
    userMessage: string;
    history?: ChatMessage[];
    signal?: AbortSignal;
  }): Promise<AdapterResponse> {
    const startTime = Date.now();
    const { conversationId, userMessage, history, signal } = params;

    // 构建请求体
    const requestBody: any = {
      input: {
        prompt: userMessage,
      },
      parameters: {
        session_id: conversationId,
      },
    };

    // 如果有历史消息，构建 messages 格式
    if (history && history.length > 0) {
      requestBody.input.messages = [
        ...history.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: 'user', content: userMessage },
      ];
      delete requestBody.input.prompt;
    }

    try {
      const response = await fetch(
        `${BAILIAN_BASE_URL}/api/v1/apps/${this.appId}/completion`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal,
        }
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const body = await response.text();
        const errorType = this.mapErrorType(response.status, body);
        throw new AdapterError(errorType, response.status, body);
      }

      const data = await response.json();
      const content = this.extractContent(data);

      return {
        content,
        raw: data,
        latencyMs,
        tokenUsage: this.extractTokenUsage(data),
      };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new AdapterError('timeout', 0, 'Request aborted');
      }
      throw new AdapterError('unknown', 0, (error as Error).message);
    }
  }

  /**
   * 清理会话（百炼无需显式关闭）
   */
  async closeConversation(_conversationId: string): Promise<void> {
    // 百炼的 session 会自动过期，无需显式关闭
  }

  /**
   * 从响应中提取文本内容
   */
  private extractContent(data: any): string {
    // 百炼应用模式的响应结构
    if (data?.output?.text) {
      return data.output.text;
    }
    if (data?.output?.choices?.[0]?.message?.content) {
      return data.output.choices[0].message.content;
    }
    if (typeof data?.output === 'string') {
      return data.output;
    }
    return JSON.stringify(data?.output || '');
  }

  /**
   * 提取 token 使用量
   */
  private extractTokenUsage(data: any): { input: number; output: number } | undefined {
    const usage = data?.usage;
    if (usage) {
      return {
        input: usage.input_tokens || usage.prompt_tokens || 0,
        output: usage.output_tokens || usage.completion_tokens || 0,
      };
    }
    return undefined;
  }

  /**
   * 映射百炼错误码到统一错误类型
   */
  private mapErrorType(status: number, body: string): 'auth_failed' | 'not_found' | 'rate_limit' | 'timeout' | 'server_error' | 'content_filtered' | 'unknown' {
    if (status === 401 || status === 403) return 'auth_failed';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limit';

    // 400 错误：可能是内容安全审核
    if (status === 400) {
      try {
        const parsed = JSON.parse(body);
        const code = parsed?.code || parsed?.Code || '';
        const msg = parsed?.message || parsed?.Message || '';
        if (code.includes('ContentFilter') || code.includes('Safety') ||
            msg.includes('安全') || msg.includes('违规') || msg.includes('sensitive')) {
          return 'content_filtered';
        }
      } catch {}
      return 'content_filtered'; // 百炼 400 大概率是内容审核
    }

    // 尝试解析错误体
    try {
      const parsed = JSON.parse(body);
      const code = parsed?.code || parsed?.Code || '';
      if (code.includes('InvalidApiKey') || code.includes('Unauthorized')) return 'auth_failed';
      if (code.includes('Throttling') || code.includes('RateLimit')) return 'rate_limit';
      if (code.includes('NotFound')) return 'not_found';
    } catch {}

    if (status >= 500) return 'server_error';
    return 'unknown';
  }
}
