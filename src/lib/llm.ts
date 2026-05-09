import OpenAI from 'openai';
import { logger } from './logger';

/**
 * 创建 OpenAI 兼容的 LLM 客户端
 * 支持 DeepSeek、Claude、本地模型等任何 OpenAI 兼容接口
 */
export function createLLMClient() {
  const baseURL = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
  const apiKey = process.env.LLM_API_KEY || '';

  if (!apiKey) {
    logger.warn('LLM_API_KEY 未配置，用例生成和评估功能将不可用');
  }

  return new OpenAI({
    baseURL,
    apiKey,
  });
}

/**
 * 调用 LLM 并返回结构化 JSON
 */
export async function callLLMForJSON<T>(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const client = createLLMClient();
  const model = params.model || process.env.LLM_MODEL || 'claude-sonnet-4-6';

  // 在 system prompt 末尾追加 JSON 输出要求
  const systemPrompt = params.systemPrompt + '\n\n【重要】请直接输出纯 JSON，不要用 markdown 代码块包裹，不要添加任何解释文字。';

  // 180 秒超时，防止 LLM 调用卡住
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 16384,
    }, { signal: controller.signal as any });
  } finally {
    clearTimeout(timeout);
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM 返回空内容');
  }

  try {
    return JSON.parse(content) as T;
  } catch (e) {
    // 尝试提取完整的 ```json ... ``` 块
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]) as T; } catch {}
    }
    // 如果有 ```json 开头但没有闭合（被截断），提取 ```json 后面的所有内容
    const codeBlockStart = content.indexOf('```json');
    if (codeBlockStart !== -1) {
      const jsonContent = content.slice(codeBlockStart + 7).replace(/```\s*$/, '').trim();
      try { return JSON.parse(jsonContent) as T; } catch {
        // 尝试修复截断
        const repaired = repairTruncatedJSON(jsonContent);
        if (repaired) {
          try { return JSON.parse(repaired) as T; } catch {}
        }
      }
    }
    // 尝试找到第一个 { 或 [
    const start = content.indexOf('{') !== -1 ? content.indexOf('{') : content.indexOf('[');
    if (start !== -1) {
      const end = content.lastIndexOf('}') !== -1 ? content.lastIndexOf('}') + 1 : content.lastIndexOf(']') + 1;
      try { return JSON.parse(content.slice(start, end)) as T; } catch {}
    }
    // 尝试修复被截断的 JSON（常见于 token 限制导致的截断）
    const repaired = repairTruncatedJSON(content);
    if (repaired) {
      try { return JSON.parse(repaired) as T; } catch {}
    }
    throw new Error(`LLM 返回非 JSON 内容: ${content.slice(0, 200)}`);
  }
}

/**
 * 尝试修复被截断的 JSON
 * 使用"安全截断点"算法：逐字符扫描，记录最后一个不在字符串内部的完整值结束位置
 */
function repairTruncatedJSON(content: string): string | null {
  const start = content.indexOf('{') !== -1 ? content.indexOf('{') : content.indexOf('[');
  if (start === -1) return null;

  let json = content.slice(start);

  // 逐字符扫描，找到最后一个"安全截断点"
  // 安全截断点 = 不在字符串内部的 } 或 ] 或 字符串闭合引号后
  let lastSafeEnd = -1;
  let inStr = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inStr) { escaped = true; continue; }
    if (ch === '"') {
      inStr = !inStr;
      if (!inStr) lastSafeEnd = i; // 字符串正常闭合
      continue;
    }
    if (inStr) continue;
    // 不在字符串内
    if (ch === '}' || ch === ']') lastSafeEnd = i;
  }

  if (lastSafeEnd <= 0) return null;

  // 在最后一个安全点截断
  json = json.slice(0, lastSafeEnd + 1);

  // 移除末尾的悬挂逗号
  json = json.replace(/,\s*$/, '');

  // 重新计算未闭合的括号并补全
  let braces = 0, brackets = 0;
  inStr = false;
  escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inStr) { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }

  while (brackets > 0) { json += ']'; brackets--; }
  while (braces > 0) { json += '}'; braces--; }

  return json;
}

/**
 * 调用 LLM 返回纯文本
 */
export async function callLLMForText(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const client = createLLMClient();
  const model = params.model || process.env.LLM_MODEL || 'claude-sonnet-4-6';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
    }, { signal: controller.signal as any });
  } finally {
    clearTimeout(timeout);
  }

  return response.choices[0]?.message?.content || '';
}
