/** sessionStorage 键：从文案页带到提示词反推页的选中结构 */
export const COPYWRITING_TO_PROMPT_KEY = 'copywriting-to-prompt-reverse';

export interface CopywritingSelectionPayload {
  mainTitle: string;
  subInfo: string;
  benefits: string;
}

/** 从文案页一次性带到提示词页的多条海报文案（与 sessionStorage 对应） */
export interface CopywritingBatchTransport {
  items: CopywritingSelectionPayload[];
}

/** 展示 / 复制用：主标题：\\n内容\\n辅助信息：\\n…\\n利益点：\\n… */
export function formatCopyBlockNewline(p: CopywritingSelectionPayload): string {
  const t = (s: string) => s.trim();
  const main = t(p.mainTitle) || '（未填）';
  const sub = t(p.subInfo) || '（未填）';
  const ben = t(p.benefits) || '（未填）';
  return `主标题：\n${main}\n辅助信息：\n${sub}\n利益点：\n${ben}`;
}

/** 与提示词反推页「海报文案」一致 */
export function copyPayloadToMainText(p: CopywritingSelectionPayload): string {
  return formatCopyBlockNewline(p);
}

/**
 * 将「主标题：\\n…\\n辅助信息：\\n…\\n利益点：\\n…」解析回结构；失败返回 null。
 * 兼容标签后换行或同行紧接正文。
 */
function indexOfLabel(s: string, labelCn: string): { idx: number; len: number } | null {
  const full = `${labelCn}：`;
  const half = `${labelCn}:`;
  let idx = s.indexOf(full);
  if (idx !== -1) return { idx, len: full.length };
  idx = s.indexOf(half);
  if (idx !== -1) return { idx, len: half.length };
  return null;
}

export function parseCopyBlockNewline(raw: string): CopywritingSelectionPayload | null {
  const s = raw.trim();
  const m = indexOfLabel(s, '主标题');
  const sub = indexOfLabel(s, '辅助信息');
  const ben = indexOfLabel(s, '利益点');
  if (!m || !sub || !ben || !(m.idx < sub.idx && sub.idx < ben.idx)) return null;

  const mainTitle = s
    .slice(m.idx + m.len, sub.idx)
    .replace(/^\s*\n?/, '')
    .replace(/\s+$/, '')
    .trim();
  const subInfo = s
    .slice(sub.idx + sub.len, ben.idx)
    .replace(/^\s*\n?/, '')
    .replace(/\s+$/, '')
    .trim();
  const benefits = s
    .slice(ben.idx + ben.len)
    .replace(/^\s*\n?/, '')
    .replace(/\s+$/, '')
    .trim();

  if (!mainTitle && !subInfo && !benefits) return null;
  return { mainTitle, subInfo, benefits };
}

function splitMdTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  return trimmed
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function isMdSeparatorRow(cells: string[]): boolean {
  return cells.some((c) => /^:?-{3,}:?$/.test(c.trim()));
}

/** 从一段 Markdown 管道表格中提取主标题 / 辅助信息 / 利益点（需三行齐全） */
function parseSingleMarkdownTable(block: string[]): CopywritingSelectionPayload | null {
  let mainTitle = '';
  let subInfo = '';
  let benefits = '';
  for (const line of block) {
    const cells = splitMdTableRow(line);
    if (cells.length < 2) continue;
    if (isMdSeparatorRow(cells)) continue;
    const key = cells[0].replace(/\s/g, '');
    const val = cells.slice(1).join('|').trim();
    if (key === '主标题') mainTitle = val;
    else if (key === '辅助信息') subInfo = val;
    else if (key === '利益点') benefits = val;
  }
  if (mainTitle && subInfo && benefits) {
    return { mainTitle, subInfo, benefits };
  }
  return null;
}

function stripOuterCodeFence(s: string): string {
  let t = s.trim();
  t = t.replace(/^```(?:markdown|md)?\s*\n?/i, '');
  t = t.replace(/\n?```[\s"'」』]*$/i, '');
  return t;
}

export type ParsedTableCopy = {
  parsed: CopywritingSelectionPayload;
  /** 紧邻表格上方的 `### …` 标题 */
  sectionLabel?: string;
};

/**
 * 从 AI 回复中解析「区域 | 内容」型 Markdown 表格，每个含主标题+辅助信息+利益点的表格为一组。
 * 支持每个 ### 小节下一张表的多组结构。
 */
export function parseMarkdownTableCopies(raw: string): ParsedTableCopy[] {
  const content = stripOuterCodeFence(raw);
  const lines = content.split('\n');
  const out: ParsedTableCopy[] = [];
  let i = 0;
  let pendingHeading: string | undefined;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('###')) {
      pendingHeading = trimmed.replace(/^#+\s*/, '').trim();
      i++;
      continue;
    }
    if (trimmed.startsWith('|')) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        block.push(lines[i]);
        i++;
      }
      const parsed = parseSingleMarkdownTable(block);
      if (parsed) {
        out.push({ parsed, sectionLabel: pendingHeading });
      }
      pendingHeading = undefined;
      continue;
    }
    i++;
  }
  return out;
}
