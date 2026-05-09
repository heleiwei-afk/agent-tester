import type { AgentAdapter } from './base';
import { AdapterError } from './base';
import type { AdapterResponse, ChatMessage } from '../types';
import { createTaskLogger } from '../logger';
import { v4 as uuid } from 'uuid';

const logger = createTaskLogger('coze-cn-adapter');

const COZE_CN_BASE_URL = 'https://api.coze.cn';

/**
 * Coze 国内版适配器
 * 
 * 端点：POST /v3/chat
 * 鉴权：Authorization: Bearer pat_xxx
 * 多轮：通过 conversation_id 维持上下文
 * 流式：stream: true + SSE
 */
export class CozeCnAdapter implements AgentAdapter {
  readonly platform: 'coze_cn' | 'coze_global' = 'coze_cn';
  protected baseUrl: string;
  private apiKey: string;
  private botId: string;

  constructor(apiKey: string, botId: string, baseUrl?: string) {
    this.apiKey = apiKey.trim();
    this.botId = botId.trim();
    this.baseUrl = baseUrl || COZE_CN_BASE_URL;
  }

  /**
   * 校验凭证
   */
  async validate(): Promise<void> {
    try {
      // 用 /v3/bots/retrieve 接口验证 key 和 bot 是否有效
      const response = await fetch(`${this.baseUrl}/v3/bots/retrieve?bot_id=${this.botId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401 || response.status === 403) {
        throw new AdapterError('auth_failed', response.status, await response.text());
      }

      const data = await response.json();
      if (data.code === 4100) {
        throw new AdapterError('auth_failed', response.status, data);
      }
      if (data.code === 4013) {
        throw new AdapterError('rate_limit', response.status, data);
      }
      if (response.status === 404 || data.code === 4004) {
        throw new AdapterError('not_found', response.status, data);
      }
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError('unknown', 0, (error as Error).message);
    }
  }

  /**
   * 获取智能体名称
   */
  async getAgentName(): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/v3/bots/retrieve?bot_id=${this.botId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data?.name) {
          return data.data.name;
        }
      }
      return `Coze Bot-${this.botId.slice(-6)}`;
    } catch {
      return `Coze Bot-${this.botId.slice(-6)}`;
    }
  }

  /**
   * 创建会话
   */
  async createConversation(): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/v3/conversations/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bot_id: this.botId }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data?.id) {
          return data.data.id;
        }
      }
      // 如果创建失败，用 uuid 作为 fallback
      return uuid();
    } catch {
      return uuid();
    }
  }

  /**
   * 发送消息并获取响应（非流式）
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
      bot_id: this.botId,
      user_id: 'agent-tester',
      stream: false,
      auto_save_history: true,
      additional_messages: [
        {
          role: 'user',
          content: userMessage,
          content_type: 'text',
        },
      ],
    };

    // 如果有 conversationId，传入
    if (conversationId && !conversationId.includes('-')) {
      // Coze 的 conversation_id 是纯数字，uuid 格式的是我们自己生成的 fallback
      requestBody.conversation_id = conversationId;
    }

    try {
      const response = await fetch(`${this.baseUrl}/v3/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const body = await response.text();
        const errorType = this.mapErrorType(response.status, body);
        throw new AdapterError(errorType, response.status, body);
      }

      const data = await response.json();

      // 检查 Coze 业务错误码
      if (data.code && data.code !== 0) {
        const errorType = this.mapCozeErrorCode(data.code);
        throw new AdapterError(errorType, response.status, data);
      }

      // 非流式模式：需要轮询获取结果
      const chatId = data.data?.id;
      const convId = data.data?.conversation_id || conversationId;

      if (chatId && convId) {
        // 轮询获取结果
        const result = await this.pollChatResult(convId, chatId, signal);
        return {
          content: result.content,
          raw: result.raw,
          latencyMs: Date.now() - startTime,
          tokenUsage: result.tokenUsage,
        };
      }

      // 如果直接返回了结果
      const content = this.extractContent(data);
      return { content, raw: data, latencyMs };

    } catch (error) {
      if (error instanceof AdapterError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new AdapterError('timeout', 0, 'Request aborted');
      }
      throw new AdapterError('unknown', 0, (error as Error).message);
    }
  }

  /**
   * 轮询获取聊天结果
   */
  private async pollChatResult(
    conversationId: string,
    chatId: string,
    signal?: AbortSignal
  ): Promise<{ content: string; raw: unknown; tokenUsage?: { input: number; output: number } }> {
    const maxAttempts = 60; // 最多轮询 60 次（每次 1 秒）
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (signal?.aborted) {
        throw new AdapterError('timeout', 0, 'Request aborted during polling');
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      try {
        const response = await fetch(
          `${this.baseUrl}/v3/chat/retrieve?conversation_id=${conversationId}&chat_id=${chatId}`,
          {
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            signal,
          }
        );

        if (!response.ok) continue;

        const data = await response.json();
        const status = data.data?.status;

        if (status === 'completed') {
          // 获取消息列表
          const msgResponse = await fetch(
            `${this.baseUrl}/v3/chat/message/list?conversation_id=${conversationId}&chat_id=${chatId}`,
            {
              headers: { 'Authorization': `Bearer ${this.apiKey}` },
              signal,
            }
          );

          if (msgResponse.ok) {
            const msgData = await msgResponse.json();
            const assistantMsg = (msgData.data || []).find(
              (m: any) => m.role === 'assistant' && m.type === 'answer'
            );

            return {
              content: assistantMsg?.content || '',
              raw: msgData,
              tokenUsage: data.data?.usage ? {
                input: data.data.usage.input_count || 0,
                output: data.data.usage.output_count || 0,
              } : undefined,
            };
          }
        }

        if (status === 'failed') {
          throw new AdapterError('server_error', 0, data.data?.last_error || 'Chat failed');
        }
      } catch (error) {
        if (error instanceof AdapterError) throw error;
        // 网络错误继续重试
      }
    }

    throw new AdapterError('timeout', 0, 'Polling timeout');
  }

  /**
   * 清理会话
   */
  async closeConversation(_conversationId: string): Promise<void> {
    // Coze 会话无需显式关闭
  }

  /**
   * 从响应中提取内容
   */
  private extractContent(data: any): string {
    if (data.data?.content) return data.data.content;
    if (data.msg) return data.msg;
    return '';
  }

  /**
   * 映射 HTTP 错误码
   */
  private mapErrorType(status: number, body: string): 'auth_failed' | 'not_found' | 'rate_limit' | 'timeout' | 'server_error' | 'unknown' {
    if (status === 401 || status === 403) return 'auth_failed';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limit';
    if (status >= 500) return 'server_error';

    try {
      const parsed = JSON.parse(body);
      return this.mapCozeErrorCode(parsed.code);
    } catch {}

    return 'unknown';
  }

  /**
   * 映射 Coze 业务错误码
   */
  private mapCozeErrorCode(code: number): 'auth_failed' | 'not_found' | 'rate_limit' | 'timeout' | 'server_error' | 'unknown' {
    if (code === 4100) return 'auth_failed';
    if (code === 4004) return 'not_found';
    if (code === 4013) return 'rate_limit';
    if (code >= 5000) return 'server_error';
    return 'unknown';
  }
}
