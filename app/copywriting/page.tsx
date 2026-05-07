'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  COPYWRITING_TO_PROMPT_KEY,
  formatCopyBlockNewline,
  parseCopyBlockNewline,
  parseMarkdownTableCopies,
  type CopywritingBatchTransport,
  type CopywritingSelectionPayload,
} from '@/lib/copywriting-bridge';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

type AssistantCopyOption = {
  id: string;
  messageIndex: number;
  variantIndex: number;
  sectionLabel?: string;
  parsed: CopywritingSelectionPayload;
  preview: string;
};

// 解析 AI 生成的文案，提取主标题、辅助信息、利益点（无 Markdown 表格时的兜底）
function parseCopyContent(content: string): CopywritingSelectionPayload {
  const raw = content.trim();
  let mainTitle = '';
  let subInfo = '';
  let benefits = '';

  // 单行：主标题：…；辅助信息：…；利益点：…（支持中英文分号）
  const inline = raw.match(
    /主标题[：:]\s*([\s\S]+?)\s*[；;]\s*辅助信息[：:]\s*([\s\S]+?)\s*[；;]\s*利益点[：:]\s*([\s\S]+)/i
  );
  if (inline) {
    return {
      mainTitle: inline[1].replace(/\s+/g, ' ').trim(),
      subInfo: inline[2].replace(/\s+/g, ' ').trim(),
      benefits: inline[3].replace(/\s+/g, ' ').trim(),
    };
  }

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  const mainTitlePatterns = [
    /主标题[：:]\s*(.+)/i,
    /标题[：:]\s*(.+)/i,
    /主标[：:]\s*(.+)/i,
    /^#{1,2}\s*(.+)$/,
    /^\*\*(.+)\*\*$/,
  ];

  const subInfoPatterns = [
    /辅助信息[：:]\s*(.+)/i,
    /副标题[：:]\s*(.+)/i,
    /副标[：:]\s*(.+)/i,
    /辅助[：:]\s*(.+)/i,
  ];

  const benefitsPatterns = [
    /利益点[：:]\s*(.+)/i,
    /卖点[：:]\s*(.+)/i,
    /核心利益[：:]\s*(.+)/i,
    /利益[：:]\s*(.+)/i,
  ];

  for (const line of lines) {
    if (!mainTitle) {
      for (const pattern of mainTitlePatterns) {
        const match = line.match(pattern);
        if (match?.[1]) {
          mainTitle = match[1].trim();
          break;
        }
      }
    }
    if (!subInfo) {
      for (const pattern of subInfoPatterns) {
        const match = line.match(pattern);
        if (match?.[1]) {
          subInfo = match[1].trim();
          break;
        }
      }
    }
    if (!benefits) {
      for (const pattern of benefitsPatterns) {
        const match = line.match(pattern);
        if (match?.[1]) {
          benefits = match[1].trim();
          break;
        }
      }
    }
  }

  if (!mainTitle && lines.length > 0) {
    mainTitle = lines[0].replace(/^[#*\-\s]+/, '').trim();
  }
  if (!subInfo && lines.length > 1) {
    subInfo = lines[1].replace(/^[#*\-\s]+/, '').trim();
  }
  if (!benefits && lines.length > 2) {
    benefits = lines[2].replace(/^[#*\-\s]+/, '').trim();
  }

  return { mainTitle, subInfo, benefits };
}

export default function CopywritingPage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  /** 底部列表中被用户删除的选项 id（解析仍来自 messages，仅隐藏） */
  const [deletedOptionIds, setDeletedOptionIds] = useState<Record<string, boolean>>({});
  /** 确认后的文案全文（与 format 一致），按选项 id */
  const [savedEdits, setSavedEdits] = useState<Record<string, string>>({});
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const allAssistantOptions = useMemo((): AssistantCopyOption[] => {
    const out: AssistantCopyOption[] = [];
    messages.forEach((m, messageIndex) => {
      if (m.role !== 'assistant') return;
      const tables = parseMarkdownTableCopies(m.content);
      if (tables.length > 0) {
        tables.forEach((row, variantIndex) => {
          out.push({
            id: `${messageIndex}-${variantIndex}`,
            messageIndex,
            variantIndex,
            sectionLabel: row.sectionLabel,
            parsed: row.parsed,
            preview: formatCopyBlockNewline(row.parsed),
          });
        });
      } else {
        const parsed = parseCopyContent(m.content);
        out.push({
          id: `${messageIndex}-0`,
          messageIndex,
          variantIndex: 0,
          parsed,
          preview: formatCopyBlockNewline(parsed),
        });
      }
    });
    return out;
  }, [messages]);

  const visibleAssistantOptions = useMemo(
    () => allAssistantOptions.filter((o) => !deletedOptionIds[o.id]),
    [allAssistantOptions, deletedOptionIds]
  );

  useEffect(() => {
    if (visibleAssistantOptions.length === 0) {
      setSelectedOptionId(null);
      return;
    }
    setSelectedOptionId((cur) => {
      if (cur && visibleAssistantOptions.some((o) => o.id === cur)) return cur;
      return visibleAssistantOptions[visibleAssistantOptions.length - 1].id;
    });
  }, [visibleAssistantOptions]);

  const handleDeleteOption = (id: string) => {
    setDeletedOptionIds((prev) => ({ ...prev, [id]: true }));
    setEditingOptionId((cur) => (cur === id ? null : cur));
    setSavedEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleStartEdit = (opt: AssistantCopyOption) => {
    setEditingOptionId(opt.id);
    setEditDraft(savedEdits[opt.id] ?? opt.preview);
  };

  const handleConfirmEdit = (optId: string) => {
    setSavedEdits((prev) => ({ ...prev, [optId]: editDraft }));
    setEditingOptionId(null);
  };

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/copywriting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMsg.content,
          conversation_id: conversationId,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || '生成失败');
        return;
      }

      if (data.conversation_id && !conversationId) {
        setConversationId(data.conversation_id);
      }

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.reply || '(无回复内容)',
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(scrollToBottom, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const clearChat = () => {
    setMessages([]);
    setConversationId(undefined);
    setError('');
    setSelectedOptionId(null);
    setDeletedOptionIds({});
    setSavedEdits({});
    setEditingOptionId(null);
    setEditDraft('');
  };

  const handleGoToPromptReverse = () => {
    if (visibleAssistantOptions.length === 0) {
      setError('暂无文案提取条目，请先在对话中生成 AI 回复');
      return;
    }
    const items: CopywritingSelectionPayload[] = visibleAssistantOptions.map((opt) => {
      const text = savedEdits[opt.id] ?? opt.preview;
      return parseCopyBlockNewline(text) ?? opt.parsed;
    });
    const payload: CopywritingBatchTransport = { items };
    try {
      sessionStorage.setItem(COPYWRITING_TO_PROMPT_KEY, JSON.stringify(payload));
    } catch {
      setError('无法保存文案，请检查浏览器是否禁用存储');
      return;
    }
    setError('');
    router.push('/prompt-reverse?from=copywriting');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-7xl mx-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">📝 文案生成</h1>
          <div className="flex gap-3">
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="text-sm text-gray-500 hover:text-red-500 transition-colors"
              >
                🗑️ 清空对话
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {/* 对话区域 */}
          <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col" style={{ minHeight: 'calc(100vh - 280px)' }}>
            {/* 对话区域 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {messages.length === 0 ? (
                /* 空状态 */
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="text-6xl mb-4">✍️</div>
                  <h2 className="text-xl font-semibold text-gray-700 mb-2">AI 文案助手</h2>
                  <p className="text-sm text-gray-400 max-w-md">
                    输入产品信息；若 AI 返回「区域｜内容」型 Markdown 表格，底部会按主标题、辅助信息、利益点拆成多条可选文案。
                  </p>

                  {/* 快捷示例 */}
                  <div className="mt-8 grid grid-cols-2 gap-3 max-w-lg w-full">
                    {[
                      { emoji: '🐱', text: '勒堡乳铁蛋白，猫用免疫保健品' },
                      { emoji: '💊', text: '宠物化毛片，5酶+3菌配方' },
                      { emoji: '🦴', text: '狗用关节宝，氨糖软骨素' },
                      { emoji: '✨', text: '生成小红书种草文案' },
                    ].map((item) => (
                      <button
                        key={item.text}
                        onClick={() => setInput(item.text)}
                        className="text-left px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 hover:border-blue-400 hover:bg-blue-50 transition-colors text-sm text-gray-600"
                      >
                        <span className="mr-1">{item.emoji}</span>
                        {item.text}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* 消息列表 */
                messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-5 py-3.5 ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-gray-100 text-gray-800 rounded-bl-md'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div className="space-y-3">
                          <div className="text-sm leading-relaxed whitespace-pre-wrap prose prose-sm max-w-none">
                            {msg.content}
                          </div>
                          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200/60">
                            <button
                              onClick={() => copyToClipboard(msg.content)}
                              className="text-xs px-3 py-1.5 rounded-md bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
                            >
                              📋 复制原文
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const opts = visibleAssistantOptions.filter((o) => o.messageIndex === idx);
                                const last = opts[opts.length - 1];
                                if (last) setSelectedOptionId(last.id);
                              }}
                              className="text-xs px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 transition-colors"
                            >
                              在底部选中本回复最后一条
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {/* 加载中指示器 */}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-bl-md px-5 py-3.5">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      AI 正在思考中...
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mx-6 mb-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 text-sm">
                ❌ {error}
              </div>
            )}

            {/* 输入区域 */}
            <div className="border-t border-gray-200 p-4 bg-white rounded-b-xl">
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-gray-700">
                <p className="mb-1.5 font-medium text-amber-900">输入提示词格式参考</p>
                <ul className="list-disc space-y-1 pl-4 leading-relaxed marker:text-amber-700">
                  <li>品牌/产品名：勒堡化毛片</li>
                  <li>所属品类：宠物保健品</li>
                  <li>王牌卖点(1-2个)：16小时排毛、7倍排毛</li>
                  <li>辅助卖点(3-5个)：专研化毛酶、宠院同款、733%排毛、只排不吐、温和化毛</li>
                </ul>
              </div>
              <div className="flex gap-3">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="输入产品信息或文案需求，按 Enter 发送..."
                  className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[44px] max-h-32"
                  style={{ fieldSizing: 'content' }}
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className={`px-6 py-3 rounded-xl font-medium text-sm transition-colors ${
                    loading || !input.trim()
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {loading ? '发送中...' : '发送'}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400 text-center">
                按 Enter 发送 · Shift+Enter 换行 · 底部全部提取文案将带入提示词页，点「去生成提示器」
              </p>
            </div>
          </div>

          {/* 底部：解析后的文案供选择 + 去生成提示器 */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-800">
                文案提取（主标题 / 辅助信息 / 利益点）
              </h2>
              <button
                type="button"
                onClick={handleGoToPromptReverse}
                disabled={visibleAssistantOptions.length === 0}
                className={`shrink-0 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors ${
                  visibleAssistantOptions.length === 0
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                去生成提示器
              </button>
            </div>

            {visibleAssistantOptions.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">
                {allAssistantOptions.length > 0
                  ? '当前提取条目已全部删除。可清空对话后重新生成。'
                  : '暂无 AI 回复。若回复中含 Markdown 表格（主标题、辅助信息、利益点），将按组列出。'}
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleAssistantOptions.map((opt) => {
                  const isSelected = selectedOptionId === opt.id;
                  const isEditing = editingOptionId === opt.id;
                  const displayText = savedEdits[opt.id] ?? opt.preview;
                  return (
                    <li key={opt.id}>
                      <div
                        className={`flex min-h-[140px] gap-3 rounded-lg border p-4 text-left outline-none transition-colors focus-within:ring-2 focus-within:ring-blue-400 ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                            : 'border-gray-200 bg-gray-50 hover:border-blue-300'
                        }`}
                        onClick={() => {
                          if (!isEditing) setSelectedOptionId(opt.id);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              rows={8}
                              className="w-full resize-y rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm leading-relaxed text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              autoFocus
                            />
                          ) : (
                            <p className="cursor-pointer text-sm leading-relaxed text-gray-900 whitespace-pre-wrap break-words">
                              {displayText}
                            </p>
                          )}
                        </div>
                        <div
                          className="flex min-h-[7rem] shrink-0 flex-col items-end justify-between gap-2 self-stretch"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isEditing ? (
                            <button
                              type="button"
                              onClick={() => handleConfirmEdit(opt.id)}
                              className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                            >
                              确认
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartEdit(opt)}
                              className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              编辑
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:text-red-800"
                            onClick={() => handleDeleteOption(opt.id)}
                          >
                            删除此条文案
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
