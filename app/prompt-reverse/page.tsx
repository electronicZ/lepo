'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  COPYWRITING_TO_PROMPT_KEY,
  type CopywritingBatchTransport,
  type CopywritingSelectionPayload,
  copyPayloadToMainText,
} from '@/lib/copywriting-bridge';

interface PromptResult {
  productPrompt: string;
  stylePrompt: string;
  llmResponse: string;
  finalPrompt: string;
}

const PRODUCT_INFO_REFERENCE = `你是一位拥有10年电商视觉营销经验的资深设计师，擅长将消费者痛点转化为高转化的详情页（LP）。你现在负责“勒堡化毛片”的商品主图。保持图片文案简洁有力。

【产品卖点】
勒堡纤维素化毛片摒弃了传统化毛膏高糖高油的弊端，采用“5酶+3菌”的科学协同体系，联合德国进口纤维与印度圆苞车前子，实现16小时内排毛量提升733%的实测表现；其化、排、护、固四效合一的配方不仅温和无催吐，更通过南极磷虾油与生物素从源头强韧被毛，配合“6大0添加”的医研级标准，为猫咪提供了一套高效、专业且零负担的肠道毛球清理方案。

【 包装与含量】
产品规格： 180片/瓶
净含量： 90g
单瓶机制： 1瓶正装（39.9元）
促销机制： 买二送一 不吃包退

【食用建议】
根据猫咪体重，每日建议喂食量如下：
5kg以下： 2 - 4片/天
5kg - 10kg： 4 - 8片/天
10kg以上： 8 - 12片/天

【核心成分规格】
原料组成： 麦苗粉、进口车前子、虾油、进口纤维素。
技术指标： 包含5种生物酶（木瓜蛋白酶等）、3种益生菌（屎肠球菌等）。
安全标准： 6大0添加（无蔗糖、无色素、无香精、无酒精、无防腐剂、无致敏源）。`;

const IMAGE_RULES_REFERENCE = `图1是产品图，图2是logo图，图3是排版参考图。
帮我生成一张勒堡化毛片的商品主页图。
主页图中出现的产品要和图1保持一致一模一样!!!!
主页图中不要出现任何试用装的图案。
主页图色调根据图1的产品设计进行更改。`;

const IMAGE_RULES_HINT =
  '此处是生图步骤需要用的一些限制条件，可根据实际去写。';

/** 拼在海报文案正文末尾；会先去掉已知的旧版/重复后缀再追加最新一句 */
const POSTER_COPY_LAYOUT_HINT =
  '保持主标题一致性，确保主标题、辅助信息和利益点为画面中唯一的文字信息';

const LEGACY_POSTER_COPY_HINT =
  '保持主标题一致性，确保辅助信息和利益点出现在画面中';

function stripPosterCopyHints(text: string): string {
  let s = text.trimEnd();
  const hints = [POSTER_COPY_LAYOUT_HINT, LEGACY_POSTER_COPY_HINT];
  let changed = true;
  while (changed) {
    changed = false;
    for (const h of hints) {
      if (s.endsWith(h)) {
        s = s.slice(0, -h.length).trimEnd();
        changed = true;
      }
      const block = `\n\n${h}`;
      if (s.endsWith(block)) {
        s = s.slice(0, -block.length).trimEnd();
        changed = true;
      }
    }
  }
  return s.trim();
}

function withPosterLayoutHint(mainText: string): string {
  const base = stripPosterCopyHints(mainText);
  if (!base) return POSTER_COPY_LAYOUT_HINT;
  return `${base}\n\n${POSTER_COPY_LAYOUT_HINT}`;
}

/** fixed + portal：避免父级 overflow-x-auto 裁剪悬停气泡 */
function ImageRulesHintIcon() {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({
      top: r.bottom + 8,
      left: r.left + r.width / 2,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, updatePosition]);

  const tooltip =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <span
        role="tooltip"
        className="pointer-events-none fixed z-[9999] w-max max-w-[min(260px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-md bg-gray-900 px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-white shadow-lg"
        style={{ top: coords.top, left: coords.left }}
      >
        {IMAGE_RULES_HINT}
      </span>,
      document.body
    );

  return (
    <>
      <span
        ref={wrapRef}
        className="relative inline-flex shrink-0"
        onMouseEnter={() => {
          updatePosition();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          updatePosition();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        <button
          type="button"
          tabIndex={0}
          title={IMAGE_RULES_HINT}
          className="inline-flex rounded-full text-gray-500 outline-none hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
          aria-label="生图限制规则说明"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.25" />
            <path
              d="M8 4.75v5.5"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
            />
            <circle cx="8" cy="11.85" r="0.75" fill="currentColor" />
          </svg>
        </button>
      </span>
      {tooltip}
    </>
  );
}

function newRowId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createEmptyRow(): PromptRow {
  return {
    id: newRowId(),
    mainText: '',
    layoutImage: null,
    styleImage: null,
    imageRules: '',
    result: null,
    loading: false,
    error: '',
  };
}

interface PromptRow {
  id: string;
  mainText: string;
  layoutImage: File | null;
  styleImage: File | null;
  imageRules: string;
  result: PromptResult | null;
  loading: boolean;
  error: string;
}

export default function PromptReversePage() {
  const [productInfo, setProductInfo] = useState('');
  const [rows, setRows] = useState<PromptRow[]>(() => [createEmptyRow()]);

  const patchRow = useCallback((id: string, patch: Partial<PromptRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('from') !== 'copywriting') return;

    try {
      const raw = sessionStorage.getItem(COPYWRITING_TO_PROMPT_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as unknown;

      const isBatch = (v: unknown): v is CopywritingBatchTransport =>
        v !== null &&
        typeof v === 'object' &&
        'items' in v &&
        Array.isArray((v as CopywritingBatchTransport).items);

      const isLegacySingle = (v: unknown): v is CopywritingSelectionPayload =>
        v !== null &&
        typeof v === 'object' &&
        'mainTitle' in v &&
        'subInfo' in v &&
        'benefits' in v &&
        !('items' in v);

      if (isBatch(data) && data.items.length > 0) {
        setRows(
          data.items.map((parsed) => ({
            ...createEmptyRow(),
            mainText: withPosterLayoutHint(copyPayloadToMainText(parsed)),
          }))
        );
      } else if (isLegacySingle(data)) {
        const text = withPosterLayoutHint(copyPayloadToMainText(data));
        setRows((prev) => {
          if (prev.length === 0) return [{ ...createEmptyRow(), mainText: text }];
          const next = [...prev];
          next[0] = { ...next[0], mainText: text };
          return next;
        });
      }
      sessionStorage.removeItem(COPYWRITING_TO_PROMPT_KEY);
    } catch {
      sessionStorage.removeItem(COPYWRITING_TO_PROMPT_KEY);
    }

    window.history.replaceState({}, '', '/prompt-reverse');
  }, []);

  const handleGenerateRow = async (rowId: string) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row?.layoutImage) {
      patchRow(rowId, { error: '请上传排版参考图' });
      return;
    }
    if (!row.styleImage) {
      patchRow(rowId, { error: '请上传风格参考图' });
      return;
    }

    const mergedMainText = withPosterLayoutHint(row.mainText);
    patchRow(rowId, {
      loading: true,
      error: '',
      result: null,
      mainText: mergedMainText,
    });

    try {
      const formData = new FormData();
      formData.append('productImage', row.layoutImage);
      formData.append('styleImage', row.styleImage);
      if (productInfo) formData.append('productInfo', productInfo);
      formData.append('mainText', mergedMainText);
      if (row.imageRules) formData.append('imageRules', row.imageRules);

      const res = await fetch('/api/prompt-reverse', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!data.success) {
        patchRow(rowId, { loading: false, error: data.error || '生成失败' });
        return;
      }

      patchRow(rowId, { loading: false, error: '', result: data.data });
    } catch (err) {
      patchRow(rowId, {
        loading: false,
        error: err instanceof Error ? err.message : '请求失败',
      });
    }
  };

  const addRow = () => {
    setRows((prev) => [...prev, createEmptyRow()]);
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((r) => r.id !== rowId);
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">🎨 电商主图提示词生成</h1>

        <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {/* 顶部：全站共用 */}
          <section className="space-y-2">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-5 lg:items-start">
              <div className="flex flex-col gap-2 lg:col-span-3">
                <label className="block text-sm font-medium leading-5 text-gray-800">
                  产品信息与角色设定
                </label>
                <textarea
                  value={productInfo}
                  onChange={(e) => setProductInfo(e.target.value)}
                  placeholder="输入产品信息与角色设定（本页多组生图共用）…"
                  className="box-border h-[min(420px,55vh)] w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-col gap-2 lg:col-span-2">
                <span className="block text-sm font-medium leading-5 text-gray-800">参考范例</span>
                <div className="box-border h-[min(420px,55vh)] overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-gray-700">
                  {PRODUCT_INFO_REFERENCE}
                </div>
              </div>
            </div>
          </section>

          {/* 每组：一行一张图 */}
          {rows.map((row, index) => (
            <section
              key={row.id}
              className="space-y-4 rounded-lg border border-gray-200 bg-slate-50/80 p-5"
            >
              <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-800">第 {index + 1} 张图</h2>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    删除本组
                  </button>
                )}
              </div>

              <p className="text-xs text-gray-500">
                海报文案可由「文案生成」页带入或在此编辑；失焦与生成前会在正文末尾自动补上「{POSTER_COPY_LAYOUT_HINT}」（已存在则不再重复）。
              </p>

              <div className="overflow-x-auto pb-1">
                <div className="grid min-w-[1080px] grid-cols-4 gap-3 items-stretch">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-sm font-medium text-gray-700">海报文案</span>
                    <textarea
                      id={`poster-${row.id}`}
                      value={row.mainText}
                      onChange={(e) => patchRow(row.id, { mainText: e.target.value })}
                      onBlur={(e) =>
                        patchRow(row.id, {
                          mainText: withPosterLayoutHint(
                            (e.target as HTMLTextAreaElement).value
                          ),
                        })
                      }
                      placeholder={'主标题：\n…\n辅助信息：\n…\n利益点：\n…'}
                      className="min-h-[168px] w-full flex-1 resize-none rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label
                      htmlFor={`layout-${row.id}`}
                      className="text-sm font-medium text-gray-700"
                    >
                      排版参考图 <span className="text-red-500">*</span>
                    </label>
                    <ImageDropField
                      showLabel={false}
                      compact
                      label="排版参考图"
                      required
                      inputId={`layout-${row.id}`}
                      file={row.layoutImage}
                      onFile={(f) => patchRow(row.id, { layoutImage: f })}
                    />
                  </div>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label
                      htmlFor={`style-${row.id}`}
                      className="text-sm font-medium text-gray-700"
                    >
                      风格参考图 <span className="text-red-500">*</span>
                    </label>
                    <ImageDropField
                      showLabel={false}
                      compact
                      label="风格参考图"
                      required
                      inputId={`style-${row.id}`}
                      file={row.styleImage}
                      onFile={(f) => patchRow(row.id, { styleImage: f })}
                    />
                  </div>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium text-gray-700">生图限制规则</span>
                      <ImageRulesHintIcon />
                    </div>
                    <div className="flex min-h-[168px] flex-1 gap-2">
                      <textarea
                        value={row.imageRules}
                        onChange={(e) => patchRow(row.id, { imageRules: e.target.value })}
                        placeholder="本张图的生图限制…"
                        className="min-h-[168px] min-w-0 flex-1 resize-none rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex w-[10.5rem] shrink-0 flex-col gap-1">
                        <span className="text-[10px] font-medium text-gray-600">参考范例</span>
                        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] leading-snug text-gray-700 whitespace-pre-wrap">
                          {IMAGE_RULES_REFERENCE}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleGenerateRow(row.id)}
                disabled={row.loading || !row.layoutImage || !row.styleImage}
                className={`w-full rounded-lg py-3 text-sm font-medium text-white transition-colors ${
                  row.loading || !row.layoutImage || !row.styleImage
                    ? 'cursor-not-allowed bg-gray-300'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {row.loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    生成中…
                  </span>
                ) : (
                  '生成提示词'
                )}
              </button>

              {row.error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  ❌ {row.error}
                </div>
              )}

              {row.result && (
                <div className="pt-2">
                  <ResultCard
                    title="✨ 最终提示词（可直接用于生图）"
                    content={row.result.finalPrompt}
                    onCopy={() => copyToClipboard(row.result!.finalPrompt)}
                    highlight
                  />
                </div>
              )}
            </section>
          ))}

          <button
            type="button"
            onClick={addRow}
            className="w-full rounded-lg border border-dashed border-gray-300 py-3 text-sm font-medium text-gray-600 hover:border-blue-400 hover:bg-blue-50/50"
          >
            + 添加一张图（新一组）
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageDropField({
  label,
  required,
  inputId,
  file,
  onFile,
  showLabel = true,
  compact = false,
}: {
  label: string;
  required?: boolean;
  inputId: string;
  file: File | null;
  onFile: (f: File | null) => void;
  showLabel?: boolean;
  compact?: boolean;
}) {
  const previewUrl = useMemo(() => {
    if (!file) return '';
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const drop = (
    <div
      className={`rounded-lg border-2 border-dashed border-gray-300 text-center transition-colors hover:border-blue-400 ${
        compact ? 'flex min-h-[168px] flex-1 flex-col' : ''
      }`}
    >
      <input
        type="file"
        accept="image/*"
        id={inputId}
        className="hidden"
        aria-label={label}
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      <label
        htmlFor={inputId}
        className={`flex cursor-pointer flex-col ${compact ? 'min-h-0 flex-1 justify-center p-2' : 'p-4'}`}
      >
        {file && previewUrl ? (
          <div className="space-y-1">
            <img
              src={previewUrl}
              alt=""
              className={`mx-auto rounded ${compact ? 'max-h-24' : 'max-h-40'}`}
            />
            <p className="truncate px-1 text-xs text-gray-500">{file.name}</p>
          </div>
        ) : (
          <div className={compact ? 'py-4' : 'py-6'}>
            <p className="mb-1 text-xl text-gray-400">{label.includes('排版') ? '📐' : '🎨'}</p>
            <p className="text-xs text-gray-500">点击上传</p>
          </div>
        )}
      </label>
    </div>
  );

  if (!showLabel) {
    return <div className={compact ? 'flex min-h-0 flex-1 flex-col' : ''}>{drop}</div>;
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor={inputId}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {drop}
    </div>
  );
}

function ResultCard({
  title,
  content,
  onCopy,
  highlight = false,
}: {
  title: string;
  content: string;
  onCopy: () => void;
  highlight?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3
          className={`text-sm font-medium ${highlight ? 'text-blue-800' : 'text-gray-700'}`}
        >
          {title}
        </h3>
        <button
          type="button"
          onClick={handleCopy}
          className={`rounded px-2 py-1 text-xs ${
            copied
              ? 'bg-green-100 text-green-700'
              : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          {copied ? '✅ 已复制' : '📋 复制'}
        </button>
      </div>
      <pre className="max-h-60 overflow-y-auto break-words text-xs whitespace-pre-wrap text-gray-800">
        {content}
      </pre>
    </div>
  );
}
