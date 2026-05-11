import { generateMarkdownReport } from './index';
import { createTaskLogger } from '../logger';

const logger = createTaskLogger('pdf-report');

/**
 * 生成 PDF 报告
 * 策略：Puppeteer 优先（高质量排版），pdfkit fallback（轻量无依赖）
 * 两者都失败才返回 null
 */
export async function generatePDFReport(reportData: any): Promise<Buffer | null> {
  // 尝试 Puppeteer（高质量 HTML → PDF）
  try {
    const result = await generatePDFWithPuppeteer(reportData);
    if (result) {
      logger.info({ size: result.length }, 'Puppeteer PDF 生成成功');
      return result;
    }
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Puppeteer PDF 生成失败，尝试 pdfkit fallback');
  }

  // Fallback: pdfkit（纯 Node.js，无需 Chrome）
  try {
    const result = await generatePDFWithPDFKit(reportData);
    if (result) {
      logger.info({ size: result.length }, 'pdfkit PDF 生成成功（fallback）');
      return result;
    }
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'pdfkit PDF 生成也失败');
  }

  return null;
}

// ============================================================
// 方案 A: Puppeteer（HTML → PDF，高质量排版）
// ============================================================

async function generatePDFWithPuppeteer(reportData: any): Promise<Buffer | null> {
  const markdown = generateMarkdownReport(reportData);
  const html = markdownToHTML(markdown, reportData);

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ============================================================
// 方案 B: pdfkit fallback（纯 Node.js，无需浏览器）
// ============================================================

async function generatePDFWithPDFKit(reportData: any): Promise<Buffer | null> {
  const PDFDocument = (await import('pdfkit')).default;
  const markdown = generateMarkdownReport(reportData);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `测试报告 - ${reportData.agentName || '智能体'}`,
          Author: 'Agent Tester',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // 注册中文字体（使用系统字体）
      const fontPath = getChineseFontPath();
      if (fontPath) {
        doc.registerFont('Chinese', fontPath);
        doc.font('Chinese');
      }

      // 解析 Markdown 并渲染到 PDF
      renderMarkdownToPDF(doc, markdown, reportData);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 获取系统中文字体路径
 * 优先选择 .ttf 格式（pdfkit 原生支持），避免 .ttc（需要额外处理）
 */
function getChineseFontPath(): string | null {
  const fs = require('fs');
  const candidates = [
    // macOS - .ttf 优先
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    // Linux
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    // Windows
    'C:\\Windows\\Fonts\\msyh.ttc',
    'C:\\Windows\\Fonts\\simhei.ttf',
  ];

  for (const path of candidates) {
    if (fs.existsSync(path)) return path;
  }
  return null;
}

/**
 * 将 Markdown 内容渲染到 PDFKit 文档
 */
function renderMarkdownToPDF(doc: any, markdown: string, reportData: any): void {
  const lines = markdown.split('\n');
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  for (const line of lines) {
    // 检查是否需要换页
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
    }

    // H1 标题
    if (line.startsWith('# ')) {
      doc.moveDown(0.5);
      doc.fontSize(18).fillColor('#1a1a1a')
        .text(line.slice(2), { align: 'left' });
      // 下划线
      doc.moveDown(0.2);
      doc.moveTo(doc.x, doc.y)
        .lineTo(doc.x + pageWidth, doc.y)
        .strokeColor('#e5e7eb').lineWidth(1).stroke();
      doc.moveDown(0.5);
      continue;
    }

    // H2 标题
    if (line.startsWith('## ')) {
      doc.moveDown(0.8);
      doc.fontSize(14).fillColor('#374151')
        .text(line.slice(3), { align: 'left' });
      doc.moveDown(0.3);
      continue;
    }

    // H3 标题
    if (line.startsWith('### ')) {
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor('#4b5563')
        .text(line.slice(4), { align: 'left' });
      doc.moveDown(0.2);
      continue;
    }

    // H4 标题
    if (line.startsWith('#### ')) {
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('#6b7280')
        .text(line.slice(5), { align: 'left' });
      doc.moveDown(0.2);
      continue;
    }

    // 表格行（简化处理：转为文本）
    if (line.startsWith('|')) {
      // 跳过分隔行
      if (line.match(/^\|[-|: ]+\|$/)) continue;
      const cells = line.split('|').filter(s => s.trim()).map(s => s.trim());
      const text = cells.join('  |  ');
      doc.fontSize(9).fillColor('#333')
        .text(text, { align: 'left' });
      continue;
    }

    // 列表项
    if (line.startsWith('- ')) {
      const content = line.slice(2)
        .replace(/\*\*(.+?)\*\*/g, '$1')  // 去掉 bold markdown
        .replace(/✅/g, '[PASS]')
        .replace(/❌/g, '[FAIL]');
      doc.fontSize(10).fillColor('#333')
        .text(`  •  ${content}`, { align: 'left', indent: 10 });
      continue;
    }

    // 缩进列表项（子项）
    if (line.startsWith('  - ')) {
      const content = line.slice(4).replace(/\*\*(.+?)\*\*/g, '$1');
      doc.fontSize(9).fillColor('#666')
        .text(`      ◦  ${content}`, { align: 'left', indent: 20 });
      continue;
    }

    // 空行
    if (line.trim() === '') {
      doc.moveDown(0.3);
      continue;
    }

    // 普通文本
    const text = line
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/✅/g, '[PASS]')
      .replace(/❌/g, '[FAIL]')
      .replace(/⏳/g, '[WAIT]');
    doc.fontSize(10).fillColor('#333')
      .text(text, { align: 'left' });
  }

  // 页脚
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#9ca3af')
    .text(`Generated by Agent Tester | ${new Date().toISOString().slice(0, 10)}`, { align: 'center' });
}

// ============================================================
// Puppeteer HTML 模板（保留原有逻辑）
// ============================================================

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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
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
