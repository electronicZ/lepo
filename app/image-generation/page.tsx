'use client';

import { useState, useRef, useEffect } from 'react';

interface ImageResult {
  url: string;
  dataUrl?: string; // base64 原始数据
  revised_prompt?: string;
}

interface HistoryItem {
  url: string;
  dataUrl?: string; // base64 原始数据，下载优先用
  revised_prompt?: string;
  timestamp: number;
  prompt: string;
  size: string;
}

const HISTORY_KEY = 'image-gen-history';
const MAX_DAYS = 21;

function loadHistory(): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const items: HistoryItem[] = JSON.parse(raw);
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    return items.filter((i) => i.timestamp > cutoff);
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/**
 * 获取图片的 base64 data URL（用于下载）
 */
async function fetchDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function downloadImage(
  url: string,
  filename: string,
  dataUrl?: string,
  onCache?: (dataUrl: string) => void
) {
  const a = document.createElement('a');
  document.body.appendChild(a);

  if (dataUrl) {
    a.href = dataUrl;
    a.download = filename;
    a.click();
    document.body.removeChild(a);
    return;
  }
  // 直接点击同源下载链接，比异步 fetch 后再触发下载更不容易被浏览器拦截。
  a.href = `/api/image-download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
  a.download = filename;
  a.click();
  document.body.removeChild(a);

  // 后台补缓存，后续再次下载时可直接走 data URL。
  fetchDataUrl(url).then((cachedDataUrl) => {
    if (cachedDataUrl) {
      onCache?.(cachedDataUrl);
    }
  });
}

export default function ImageGenerationPage() {
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<ImageResult[]>([]);
  const [error, setError] = useState('');
  /** 四张参考图：产品图、logo、排版参考、片剂/倾倒参考（对应 ComfyUI LoadImage） */
  const [refSlots, setRefSlots] = useState<(File | null)[]>([null, null, null, null]);
  const [refPreviewUrls, setRefPreviewUrls] = useState<(string | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [resolution, setResolution] = useState('2k');
  const [quality, setQuality] = useState('medium');
  const model = 'gpt-image-2-oai';
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [previewImg, setPreviewImg] = useState<HistoryItem | null>(null);
  const previewImgRef = useRef<HistoryItem | null>(null);
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null]);

  const REF_LABELS = [
    '图1 · 产品图',
    '图2 · logo',
    '图3 · 排版参考图',
    '图4 · 片剂倾倒参考图',
  ];

  // 保持 ref 与 state 同步（供 ESC 处理器使用）
  useEffect(() => {
    previewImgRef.current = previewImg;
  }, [previewImg]);

  // ESC 键关闭预览
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewImgRef.current) {
        setPreviewImg(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 加载历史记录
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const previewUrlsUnmountRef = useRef<(string | null)[]>([null, null, null, null]);
  previewUrlsUnmountRef.current = refPreviewUrls;
  useEffect(() => {
    return () => {
      previewUrlsUnmountRef.current.forEach((u) => {
        if (u) URL.revokeObjectURL(u);
      });
    };
  }, []);

  const addToHistory = (imgs: ImageResult[]) => {
    const newItems: HistoryItem[] = imgs.map((img) => ({
      url: img.url,
      dataUrl: img.dataUrl,
      revised_prompt: img.revised_prompt,
      timestamp: Date.now(),
      prompt,
      size: `${aspectRatio} · ${resolution}`,
    }));
    const updated = [...newItems, ...history].slice(0, 200);
    setHistory(updated);
    saveHistory(updated);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const setSlotFile = (index: number, file: File | null) => {
    setRefPreviewUrls((prev) => {
      const next = [...prev];
      if (next[index]) URL.revokeObjectURL(next[index]!);
      next[index] = file ? URL.createObjectURL(file) : null;
      return next;
    });
    setRefSlots((prev) => {
      const next = [...prev];
      next[index] = file;
      return next;
    });
    setError('');
  };

  const onPickSlot = (index: number, files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    setSlotFile(index, f);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('请输入图片描述');
      return;
    }

    setLoading(true);
    setError('');
    setImages([]);

    try {
      const formData = new FormData();
      formData.append('prompt', prompt);
      formData.append('aspect_ratio', aspectRatio);
      formData.append('resolution', resolution);
      formData.append('num_images', count.toString());
      formData.append('quality', quality);
      formData.append('model', model);
      for (let i = 0; i < 4; i++) {
        if (refSlots[i]) formData.append(`image${i + 1}`, refSlots[i] as File);
      }

      const res = await fetch('/api/image-generation', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || '生成失败');
        return;
      }

      const rawImgs = data.images || data.data || [];
      // 主动获取每张图的 base64 data URL（用于下载）
      const imgs = await Promise.all(
        rawImgs.map(async (img: { index: number; url: string; revised_prompt?: string }) => {
          const dataUrl = await fetchDataUrl(img.url);
          return { url: img.url, dataUrl: dataUrl || undefined, revised_prompt: img.revised_prompt };
        })
      );
      setImages(imgs);
      addToHistory(imgs);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  };

  const hasAnyRef = refSlots.some((f) => f !== null);
  const isDisabled = loading || !prompt.trim() || !hasAnyRef;

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      {/* 大图预览弹层 */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4"
          onClick={() => setPreviewImg(null)}
        >
          <div className="relative max-w-4xl w-full">
            <button
              onClick={() => setPreviewImg(null)}
              className="absolute -top-10 right-0 text-white text-2xl hover:text-gray-300"
            >
              ✕
            </button>
            <img
              src={previewImg.url}
              alt="预览"
              className="w-full rounded-lg shadow-2xl cursor-zoom-out"
              onClick={(e) => { e.stopPropagation(); setPreviewImg(null); }}
              title="点击缩小 / 按 ESC 关闭"
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="text-white/70 text-sm space-y-1">
                <p className="text-white/50 text-xs">{formatTime(previewImg.timestamp)} · {previewImg.size}</p>
                {previewImg.prompt && (
                  <p className="line-clamp-1">提示词：{previewImg.prompt}</p>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  downloadImage(previewImg.url, `ai-${previewImg.timestamp}.png`, previewImg.dataUrl);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg flex items-center gap-2"
              >
                💾 下载
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          AI生图
        </h1>

        <div className="flex gap-6 items-start">
          {/* 左侧：主表单区域 */}
          <div className="flex-1 min-w-0 bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                接入说明
              </label>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
                <div className="font-medium">心宝（Xinbao）异步 GPT Image</div>
                <p className="mt-1 text-xs text-blue-900 leading-relaxed">
                  按{' '}
                  <a
                    href="https://skills.sh/98624017/xinbao-api-skill/xinbao-api"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline hover:no-underline"
                  >
                    xinbao-api skill
                  </a>
                  ：异步入口 <code className="rounded bg-white/80 px-1">async.xinbao-ai.com</code>，提交{' '}
                  <code className="rounded bg-white/80 px-1">POST /v1/images/generations</code>
                  ，再轮询任务结果。服务端需配置{' '}
                  <code className="rounded bg-white/80 px-1">XINBAO_API_KEY</code>；有参考图时需{' '}
                  <code className="rounded bg-white/80 px-1">IMGBB_API_KEY</code> 上传公网 URL。
                </p>
                <p className="mt-1 text-xs text-blue-800">
                  当前模型：<strong>{model}</strong>（与 skill 中 GPT Image 异步流一致）
                </p>
              </div>
            </div>

            {/* 参考图 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                参考图（至少 1 张，最多 4 张）
              </label>
              <p className="text-xs text-gray-500 mb-3">
                建议顺序：图1 产品图 → 图2 logo → 图3 排版参考 → 图4 片剂/倾倒参考；会以 URL 数组传给心宝图生图。
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[0, 1, 2, 3].map((idx) => (
                  <div key={idx} className="space-y-1.5">
                    <span className="block text-xs font-medium text-gray-600">{REF_LABELS[idx]}</span>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInputRefs.current[idx]?.click()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') fileInputRefs.current[idx]?.click();
                      }}
                      className="relative flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50"
                    >
                      {refSlots[idx] && refPreviewUrls[idx] ? (
                        <>
                          <img
                            src={refPreviewUrls[idx]!}
                            alt=""
                            className="absolute inset-0 h-full w-full rounded-md object-cover"
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSlotFile(idx, null);
                            }}
                            className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs text-white shadow"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <span className="text-2xl text-gray-400">+</span>
                      )}
                    </div>
                    <input
                      ref={(el) => {
                        fileInputRefs.current[idx] = el;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onPickSlot(idx, e.target.files)}
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  refPreviewUrls.forEach((u) => u && URL.revokeObjectURL(u));
                  setRefPreviewUrls([null, null, null, null]);
                  setRefSlots([null, null, null, null]);
                }}
                className="mt-2 text-xs text-red-600 hover:underline"
              >
                清空四张参考图
              </button>
            </div>

            {/* 提示词 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                主图提示词
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder="粘贴「提示词反推」生成的最终提示词，或自行描述主图画面、排版与卖点……"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y min-h-[120px]"
              />
            </div>

            {/* 参数 */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">画幅比例 aspectRatio</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {['1:1', '16:9', '9:16', '4:3', '3:4'].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">分辨率 resolution</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {['2k', '1k'].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">生成质量 quality</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'low', label: '低' },
                    { value: 'medium', label: '中' },
                    { value: 'high', label: '高' },
                  ].map((q) => (
                    <button
                      key={q.value}
                      type="button"
                      onClick={() => setQuality(q.value)}
                      className={
                        quality === q.value
                          ? 'rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white'
                          : 'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-blue-400'
                      }
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">gpt-image-2-oai 透传 quality（见 skill 异步 OpenAI 生图说明）</p>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  生成数量
                </label>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setCount(num)}
                      className={
                        count === num
                          ? 'w-16 rounded-lg border border-blue-600 bg-blue-600 py-2 text-sm font-medium text-white'
                          : 'w-16 rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:border-blue-400'
                      }
                    >
                      {num} 张
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 生成按钮 */}
            <button
              onClick={handleGenerate}
              disabled={isDisabled}
              className={
                isDisabled
                  ? 'w-full py-3 rounded-lg font-medium text-white bg-gray-300 cursor-not-allowed'
                  : 'w-full py-3 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700'
              }
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
                  生成中（心宝异步任务，常见约 1～5 分钟）…
                </span>
              ) : (
                '🚀 开始生成'
              )}
            </button>

            {/* 错误提示 */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                ❌ {error}
              </div>
            )}

            {/* 结果展示 */}
            {images.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-800">
                  生成结果 ({images.length} 张)
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  {images.map((img, idx) => (
                    <div key={idx} className="space-y-2">
                      <img
                        src={img.url}
                        alt={`生成的图片 ${idx + 1}`}
                        className="w-full rounded-lg shadow-md"
                      />
                      {img.revised_prompt && (
                        <p className="text-xs text-gray-500 italic">
                          优化后的提示词: {img.revised_prompt}
                        </p>
                      )}
                      <div className="flex gap-3">
                        <a
                          href={img.url}
                          download={`ai-generated-${idx + 1}.png`}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                        >
                          💾 下载图片
                        </a>
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(img.url);
                              alert('已复制');
                            } catch {
                              alert('复制失败');
                            }
                          }}
                          className="text-sm text-gray-500 hover:text-gray-700"
                        >
                          📋 复制链接
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 说明 */}
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-500 space-y-1">
              <p>
                💡 异步生图建议首次轮询前稍等（skill 建议约 50s 量级）；本服务首次轮询约 8s 后按 5s 间隔轮询，总超时约 5
                分钟。
              </p>
              <p>
                💡 多任务并发生成时使用 <code className="text-gray-600">POST /v1/tasks/batch-get</code> 取结果。
              </p>
            </div>
          </div>

          {/* 右侧：历史记录 */}
          <div className="w-72 shrink-0">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sticky top-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                  📷 历史图片
                  {history.length > 0 && (
                    <span className="ml-1 text-xs text-gray-400 font-normal">
                      {history.length}
                    </span>
                  )}
                </h3>
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    清空
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-3xl mb-2">🖼️</div>
                  <p className="text-xs">暂无历史图片</p>
                  <p className="text-xs mt-1">生成后将自动保存</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto pr-1">
                  {history.map((item, idx) => (
                    <div key={idx} className="relative group rounded-lg overflow-hidden border border-gray-100">
                      {/* 缩略图 */}
                      <div
                        className="cursor-pointer bg-gray-50"
                        onClick={() => setPreviewImg(item)}
                      >
                        <img
                          src={item.url}
                          alt="历史图片"
                          className="w-full max-h-48 object-contain"
                          loading="lazy"
                        />
                      </div>

                      {/* 下载按钮 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadImage(
                            item.url,
                            `ai-${item.timestamp}.png`,
                            item.dataUrl,
                            (dataUrl) => {
                              // 缓存到 localStorage
                              const updated = history.map((h) =>
                                h.timestamp === item.timestamp ? { ...h, dataUrl } : h
                              );
                              setHistory(updated);
                              saveHistory(updated);
                            }
                          );
                        }}
                        className="absolute top-1.5 right-1.5 w-7 h-7 bg-black/60 hover:bg-blue-600 text-white rounded-md text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        title="下载"
                      >
                        ⬇
                      </button>

                      {/* 时间戳 */}
                      <div className="bg-gray-50 px-2 py-1.5">
                        <p className="text-xs text-gray-400">{formatTime(item.timestamp)}</p>
                        {item.prompt && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate" title={item.prompt}>
                            {item.prompt.slice(0, 30)}{item.prompt.length > 30 ? '...' : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
