/**
 * 测试大纲生成引擎
 */

import { v4 as uuid } from 'uuid';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { TaskConfig, TestOutline, TestGoal, TestScenario, TestPoint, TestCase, Dimension } from '../types';
import { OUTLINE_GENERATION_PROMPT } from './prompts';
import { createTaskLogger } from '../logger';

const logger = createTaskLogger('outline-generator');

/**
 * 调用 LLM 生成测试大纲
 */
async function callLLMForOutline(
  expectedBehavior: string,
  systemPrompt: string | null,
  industry: string
): Promise<TestOutline> {
  const prompt = OUTLINE_GENERATION_PROMPT
    .replace('{expectedBehavior}', expectedBehavior)
    .replace('{systemPrompt}', systemPrompt || '（未提供）')
    .replace('{industry}', industry);

  const apiKey = process.env.LLM_API_KEY || '';
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.LLM_GENERATION_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-6';

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是专业的智能体测试架构师。严格按照要求的 JSON 格式输出。确保输出完整的 JSON，不要截断。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 16384,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API 调用失败: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // 提取 JSON（可能被 markdown 代码块包裹）
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error('LLM 返回内容不包含有效 JSON');
  }

  const outline = JSON.parse(jsonMatch[1]);
  return outline;
}

/**
 * 验证和修正大纲结构
 */
function validateOutline(outline: any): TestOutline {
  // 确保基本结构存在
  if (!outline.agentAnalysis) {
    outline.agentAnalysis = {
      coreValue: '未分析',
      targetUsers: [],
      keyCapabilities: [],
      riskAreas: [],
    };
  }

  if (!Array.isArray(outline.testGoals)) {
    outline.testGoals = [];
  }

  // 为每个节点生成 ID（如果缺失）
  outline.testGoals = outline.testGoals.map((goal: any, gIdx: number) => {
    if (!goal.id) goal.id = `goal-${gIdx + 1}`;
    if (!goal.priority) goal.priority = 'medium';
    if (!Array.isArray(goal.scenarios)) goal.scenarios = [];

    goal.scenarios = goal.scenarios.map((scenario: any, sIdx: number) => {
      if (!scenario.id) scenario.id = `scenario-${gIdx + 1}-${sIdx + 1}`;
      if (!Array.isArray(scenario.testPoints)) scenario.testPoints = [];

      scenario.testPoints = scenario.testPoints.map((point: any, pIdx: number) => {
        if (!point.id) point.id = `point-${gIdx + 1}-${sIdx + 1}-${pIdx + 1}`;
        if (!point.testType) point.testType = 'positive';
        if (!point.estimatedCaseCount) point.estimatedCaseCount = 2;
        if (!Array.isArray(point.passCriteria)) point.passCriteria = [];
        return point;
      });

      return scenario;
    });

    return goal;
  });

  return outline as TestOutline;
}

/**
 * 生成测试大纲
 */
export async function generateTestOutline(
  taskId: string,
  config: TaskConfig,
  systemPrompt: string | null
): Promise<TestOutline> {
  logger.info({ taskId }, '开始生成测试大纲');

  try {
    // 1. 调用 LLM 生成大纲
    const rawOutline = await callLLMForOutline(
      config.expectedBehavior,
      systemPrompt,
      config.industry
    );

    // 2. 验证和修正
    const validatedOutline = validateOutline(rawOutline);

    logger.info({ taskId, goalCount: validatedOutline.testGoals.length }, '大纲生成成功');

    // 3. 保存到数据库
    await db.insert(schema.testOutlines).values({
      id: uuid(),
      taskId,
      outlineJson: JSON.stringify(validatedOutline),
      systemPromptUsed: systemPrompt,
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return validatedOutline;
  } catch (error) {
    logger.error({ error: (error as Error).message, taskId }, '大纲生成失败');
    throw error;
  }
}

/**
 * 获取任务的测试大纲
 */
export async function getTestOutline(taskId: string): Promise<TestOutline | null> {
  const rows = await db
    .select()
    .from(schema.testOutlines)
    .where(eq(schema.testOutlines.taskId, taskId))
    .limit(1);

  if (rows.length === 0) return null;

  return JSON.parse(rows[0].outlineJson);
}

/**
 * 更新测试大纲
 */
export async function updateTestOutline(
  taskId: string,
  outline: TestOutline
): Promise<void> {
  const rows = await db
    .select()
    .from(schema.testOutlines)
    .where(eq(schema.testOutlines.taskId, taskId))
    .limit(1);

  if (rows.length === 0) {
    throw new Error('大纲不存在');
  }

  await db
    .update(schema.testOutlines)
    .set({
      outlineJson: JSON.stringify(outline),
      updatedAt: Date.now(),
    })
    .where(eq(schema.testOutlines.id, rows[0].id));
}

/**
 * 批准大纲（标记为 approved）
 */
export async function approveTestOutline(taskId: string): Promise<void> {
  const rows = await db
    .select()
    .from(schema.testOutlines)
    .where(eq(schema.testOutlines.taskId, taskId))
    .limit(1);

  if (rows.length === 0) {
    throw new Error('大纲不存在');
  }

  await db
    .update(schema.testOutlines)
    .set({
      status: 'approved',
      updatedAt: Date.now(),
    })
    .where(eq(schema.testOutlines.id, rows[0].id));
}

/**
 * 计算大纲预计生成的用例总数
 */
export function calculateTotalCases(outline: TestOutline): number {
  let total = 0;
  for (const goal of outline.testGoals) {
    for (const scenario of goal.scenarios) {
      for (const point of scenario.testPoints) {
        total += point.estimatedCaseCount;
      }
    }
  }
  return total;
}

/**
 * 根据测试大纲生成用例
 */
export async function generateTestCasesFromOutline(
  taskId: string,
  config: TaskConfig,
  outline: TestOutline
): Promise<TestCase[]> {
  logger.info({ taskId }, '开始根据大纲生成用例');

  const allCases: TestCase[] = [];
  let orderIndex = 0;

  // 如果有测试素材，先生成打招呼用例
  if (config.testContext) {
    const greetingCase: TestCase = {
      id: uuid(),
      taskId,
      dimension: 'alignment',
      subType: 'greeting',
      turns: [{ role: 'user', content: '你好' }],
      expectation: '智能体应该礼貌回应，展示准备就绪的状态',
      passCriteria: ['包含问候语', '语气友好'],
      weight: 2,
      evaluationStrategy: 'llm',
      status: 'pending',
      newSession: true,
      orderIndex: orderIndex++,
      goalId: undefined,
      scenarioId: undefined,
      pointId: undefined,
    };
    allCases.push(greetingCase);
  }

  // 遍历大纲生成用例
  for (const goal of outline.testGoals) {
    for (const scenario of goal.scenarios) {
      for (const point of scenario.testPoints) {
        try {
          const cases = await generateCasesForPoint(
            taskId,
            config,
            goal,
            scenario,
            point
          );

          // 标记追溯链
          cases.forEach((c) => {
            c.goalId = goal.id;
            c.scenarioId = scenario.id;
            c.pointId = point.id;
            c.orderIndex = orderIndex++;
          });

          allCases.push(...cases);
        } catch (error) {
          logger.error(
            { error: (error as Error).message, pointId: point.id },
            '生成测试点用例失败'
          );
        }
      }
    }
  }

  logger.info({ taskId, totalCases: allCases.length }, '大纲用例生成完成');
  return allCases;
}

/**
 * 为单个测试点生成用例
 */
async function generateCasesForPoint(
  taskId: string,
  config: TaskConfig,
  goal: TestGoal,
  scenario: TestScenario,
  point: TestPoint
): Promise<TestCase[]> {
  const prompt = `你是测试用例生成器。请根据以下测试点生成 ${point.estimatedCaseCount} 条具体测试用例。

【测试目标】${goal.name}
【测试优先级】${goal.priority}
【测试场景】${scenario.name}
【用户场景】${scenario.userContext}
【期望结果】${scenario.expectedOutcome}
【测试点】${point.description}
【测试类型】${point.testType}
【通过标准】${point.passCriteria.join(', ')}

【要求】
- 用例必须模拟真实用户的表达方式
- 如果场景需要多轮对话，设计合理的对话流程
- passCriteria 必须可机器验证
- 测试类型说明：
  * positive: 验证正常功能
  * negative: 验证拒绝/错误处理
  * boundary: 验证边界情况
  * stress: 验证极端情况

【输出 JSON 格式】
{
  "cases": [
    {
      "turns": [{"role": "user", "content": "..."}],
      "expectation": "...",
      "passCriteria": ["..."],
      "weight": 1-5,
      "evaluationStrategy": "rule|pattern|llm|hybrid"
    }
  ]
}`;

  const apiKey = process.env.LLM_API_KEY || '';
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.LLM_GENERATION_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-6';

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是专业的测试用例生成器。严格按照要求的 JSON 格式输出。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API 调用失败: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // 提取 JSON
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error('LLM 返回内容不包含有效 JSON');
  }

  const result = JSON.parse(jsonMatch[1]);
  const generatedCases = result.cases || [];

  // 转换为 TestCase 格式
  const testCases: TestCase[] = generatedCases.map((c: any, idx: number) => ({
    id: uuid(),
    taskId,
    dimension: mapTestTypeToDimension(point.testType),
    subType: point.description.slice(0, 50),
    turns: c.turns || [],
    expectation: c.expectation || '',
    passCriteria: c.passCriteria || [],
    weight: c.weight || 3,
    evaluationStrategy: c.evaluationStrategy || 'hybrid',
    status: 'pending' as const,
    newSession: false,
    orderIndex: idx, // 外层会覆盖为全局递增值
    goalId: undefined,
    scenarioId: undefined,
    pointId: undefined,
  }));

  return testCases;
}

/**
 * 根据测试类型映射到维度
 */
function mapTestTypeToDimension(testType: string): Dimension {
  switch (testType) {
    case 'positive':
      return 'alignment';
    case 'negative':
      return 'boundary';
    case 'boundary':
      return 'boundary';
    case 'stress':
      return 'badcase';
    default:
      return 'alignment';
  }
}
