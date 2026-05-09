import { generateMarkdownReport } from './index';
import { createTaskLogger } from '../logger';

const logger = createTaskLogger('pdf-report');

/**
 * 生成 PDF 报告
 * 将 Markdown 报告渲染为 HTML，再用 Puppeteer 转 PDF
 * 如果 Puppeteer 不可用，降级返回 null
 */
export async function generatePDFReport(reportData: any): Promise<Buffer | null> {
  try {
    const markdown = generateMarkdownReport(reportData);
    const html = markdownToHTML(markdown, reportData);

    // 动态导入 puppeteer（避免构建时报错）
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });

    await browser.close();
    return Buffer.from(pdf);
  } catch (error) {
    logger.error({ error }, 'PDF 生成失败，降级到 Markdown');
    return null;
  }
}

/**
 * 将 Markdown + 数据转为带样式的 HTML（含雷达图 SVG）
 */
function markdownToHTML(markdown: string, reportData: any): string {
  // 简单的 Markdown → HTML 转换
  let html = markdown
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // 表格转换
  html = html.replace(/\|(.+)\|\n\|[-|]+\|\n((?:\|.+\|\n?)+)/g, (match, header, body) => {
    const headers = header.split('|').filter((s: string) => s.trim()).map((s: string) => `<th>${s.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map((row: string) => {
      const cells = row.split('|').filter((s: string) => s.trim()).map((s: string) => `<td>${s.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // 生成雷达图 SVG
  const radarSVG = generateRadarSVG(reportData);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
    h2 { color: #374151; margin-top: 32px; }
    h3 { color: #4b5563; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
    th { background: #f9fafb; font-weight: 600; }
    tr:nth-child(even) { background: #f9fafb; }
    ul { padding-left: 20px; }
    li { margin: 4px 0; }
    .radar-container { text-align: center; margin: 24px 0; }
    .severity-critical { color: #dc2626; font-weight: bold; }
    .severity-high { color: #ea580c; }
    .severity-medium { color: #ca8a04; }
    .severity-low { color: #16a34a; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .pass { color: #16a34a; } .fail { color: #dc2626; }
  </style>
</head>
<body>
  <div class="radar-container">${radarSVG}</div>
  <p>${html}</p>
</body>
</html>`;
}

/**
 * 生成雷达图 SVG
 */
function generateRadarSVG(reportData: any): string {
  const dimensions = ['alignment', 'industry', 'boundary', 'badcase', 'security'];
  const labels = ['预期效果', '行业规范', '边界兜底', 'Bad Case', '安全性'];

  // 计算每个维度的得分
  const scores: number[] = dimensions.map(dim => {
    const dimCases = (reportData.cases || []).filter((c: any) => c.dimension === dim);
    const dimVerdicts = (reportData.verdicts || []).filter((v: any) =>
      dimCases.some((c: any) => c.id === v.caseId)
    );
    if (dimVerdicts.length === 0) return 0;
    return Math.round(dimVerdicts.reduce((sum: number, v: any) => sum + v.score, 0) / dimVerdicts.length);
  });

  const cx = 150, cy = 150, r = 100;
  const angleStep = (2 * Math.PI) / 5;

  // 生成五边形网格
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  let gridPaths = '';
  for (const level of gridLevels) {
    const points = dimensions.map((_, i) => {
      const angle = -Math.PI / 2 + i * angleStep;
      const x = cx + r * level * Math.cos(angle);
      const y = cy + r * level * Math.sin(angle);
      return `${x},${y}`;
    }).join(' ');
    gridPaths += `<polygon points="${points}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
  }

  // 生成数据多边形
  const dataPoints = scores.map((score, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const ratio = score / 100;
    const x = cx + r * ratio * Math.cos(angle);
    const y = cy + r * ratio * Math.sin(angle);
    return `${x},${y}`;
  }).join(' ');

  // 生成标签
  let labelElements = '';
  labels.forEach((label, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const x = cx + (r + 25) * Math.cos(angle);
    const y = cy + (r + 25) * Math.sin(angle);
    const score = scores[i];
    labelElements += `<text x="${x}" y="${y}" text-anchor="middle" font-size="12" fill="#4b5563">${label}</text>`;
    labelElements += `<text x="${x}" y="${y + 14}" text-anchor="middle" font-size="11" fill="#6b7280">${score}分</text>`;
  });

  return `<svg width="300" height="300" viewBox="0 0 300 300">
    ${gridPaths}
    <polygon points="${dataPoints}" fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" stroke-width="2"/>
    ${labelElements}
  </svg>`;
}
