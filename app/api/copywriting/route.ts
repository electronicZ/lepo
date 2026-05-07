import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/copywriting
 *
 * 调用扣子（Coze）Bot API 生成文案
 *
 * 环境变量：
 *   COZE_API_TOKEN    → 扣子 OAuth Token（cztei_ 开头）
 *   COZE_BOT_ID       → 扣子 Bot ID
 */

const COZE_API_URL = 'https://api.coze.cn/open_api/v2/chat';
const COZE_TOKEN = process.env.COZE_API_TOKEN || '';
const COZE_BOT_ID = process.env.COZE_BOT_ID || '';

interface CozeMessage {
  role: string;
  type: string;
  content: string;
  content_type?: string;
}

interface CozeResponse {
  code: number;
  msg: string;
  conversation_id?: string;
  messages?: CozeMessage[];
}

/**
 * 调用扣子 Chat API（非流式）
 */
async function callCozeChat(
  botId: string,
  userQuery: string,
  userId: string = 'user_001',
  conversationId?: string
): Promise<CozeResponse> {
  const body: Record<string, unknown> = {
    bot_id: botId,
    user: userId,
    query: userQuery,
    stream: false,
  };

  if (conversationId) {
    body.conversation_id = conversationId;
  }

  const res = await fetch(COZE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${COZE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  // Coze API 响应较慢，超时设为 120 秒
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[coze] HTTP error:', res.status, text.slice(0, 500));
    throw new Error(`扣子 API 请求失败 (${res.status})`);
  }

  const data: CozeResponse = await res.json();
  console.log('[coze] response code:', data.code, 'msg:', data.msg);

  if (data.code !== 0) {
    throw new Error(data.msg || '扣子 API 返回错误');
  }

  return data;
}

/**
 * 从 Coze 响应中提取 assistant 的文本回复
 */
function extractReply(data: CozeResponse): string {
  const msgs = data.messages || [];

  // 找 type="answer" 的 assistant 消息
  const answerMsgs = msgs.filter(
    (m) => m.role === 'assistant' && m.type === 'answer' && m.content
  );

  if (answerMsgs.length > 0) {
    return answerMsgs.map((m) => m.content).join('\n\n');
  }

  // fallback：取所有 assistant 文本内容
  const allAssistant = msgs
    .filter((m) => m.role === 'assistant' && m.content && m.content_type === 'text')
    .map((m) => m.content);

  if (allAssistant.length > 0) {
    return allAssistant.join('\n\n');
  }

  return '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, conversation_id } = body as { query?: string; conversation_id?: string };

    if (!query || !query.trim()) {
      return NextResponse.json({ error: 'query 为必填，请输入文案需求' }, { status: 400 });
    }

    if (!COZE_TOKEN) {
      return NextResponse.json(
        { error: '未配置 COZE_API_TOKEN，请前往 .env.local 设置扣子 Token' },
        { status: 500 }
      );
    }

    if (!COZE_BOT_ID) {
      return NextResponse.json(
        { error: '未配置 COZE_BOT_ID，请前往 .env.local 设置扣子 Bot ID' },
        { status: 500 }
      );
    }

    const result = await callCozeChat(COZE_BOT_ID, query.trim(), 'user_001', conversation_id);
    const reply = extractReply(result);

    return NextResponse.json({
      success: true,
      reply,
      conversation_id: result.conversation_id,
      messages: result.messages,
    });
  } catch (error) {
    console.error('[copywriting] 错误:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器内部错误' },
      { status: 500 }
    );
  }
}
