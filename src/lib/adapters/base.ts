import type { AdapterResponse, ChatMessage, ErrorType } from '../types';

/**
 * 统一平台适配器接口
 * 所有平台（百炼、Coze 国内、Coze 国际）都实现此接口
 */
export interface AgentAdapter {
  readonly platform: 'bailian' | 'coze_cn' | 'coze_global';

  /** 校验凭证可用性，失败抛 AdapterError */
  validate(): Promise<void>;

  /** 获取智能体名称 */
  getAgentName(): Promise<string>;

  /** 获取智能体的 system prompt / 角色定位描述
   * @returns system prompt 文本，如果平台不支持或获取失败则返回 null
   */
  getSystemPrompt(): Promise<string | null>;

  /** 创建一个对话会话，返回 sessionId/conversationId */
  createConversation(): Promise<string>;

  /** 发送一条用户消息，返回响应 */
  invoke(params: {
    conversationId: string;
    userMessage: string;
    history?: ChatMessage[];
    signal?: AbortSignal;
  }): Promise<AdapterResponse>;

  /** 清理会话 */
  closeConversation(conversationId: string): Promise<void>;
}

/**
 * 适配器错误类型
 */
export class AdapterError extends Error {
  constructor(
    public type: ErrorType,
    public originalStatus: number,
    public originalBody: unknown
  ) {
    super(`[${type}] HTTP ${originalStatus}`);
    this.name = 'AdapterError';
  }
}

/**
 * 创建适配器工厂
 */
export function createAdapter(platform: string, apiKey: string, botId: string): AgentAdapter {
  switch (platform) {
    case 'bailian':
      // 延迟导入避免循环依赖
      const { BailianAdapter } = require('./bailian');
      return new BailianAdapter(apiKey, botId);
    case 'coze_cn':
      const { CozeCnAdapter } = require('./coze-cn');
      return new CozeCnAdapter(apiKey, botId);
    case 'coze_global':
      const { CozeGlobalAdapter } = require('./coze-global');
      return new CozeGlobalAdapter(apiKey, botId);
    default:
      throw new Error(`不支持的平台: ${platform}`);
  }
}
