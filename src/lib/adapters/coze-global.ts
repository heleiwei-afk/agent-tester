import { CozeCnAdapter } from './coze-cn';

const COZE_GLOBAL_BASE_URL = 'https://api.coze.com';

/**
 * Coze 国际版适配器
 * 与国内版 API 完全一致，仅 base URL 不同
 */
export class CozeGlobalAdapter extends CozeCnAdapter {
  override readonly platform: 'coze_cn' | 'coze_global' = 'coze_global';

  constructor(apiKey: string, botId: string) {
    super(apiKey, botId, COZE_GLOBAL_BASE_URL);
  }
}
