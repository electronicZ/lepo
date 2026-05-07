import { NextRequest, NextResponse } from 'next/server';

// ============== 配置 ==============
const DOUBAO_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const VISION_MODEL = 'ep-20260425173854-k77rl';
const CHAT_MODEL = 'ep-20260425173259-bjp5m';
// ==================================

/**
 * 调用豆包视觉模型（反推图片描述）
 */
async function callDoubaoVision(
  imageBase64: string,
  prompt: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(DOUBAO_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: imageBase64.startsWith('data:')
                  ? imageBase64
                  : `data:image/png;base64,${imageBase64}`,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`豆包视觉API错误: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * 调用豆包LLM对话模型
 */
async function callDoubaoChat(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];

  // 系统提示词（对应工作流 node 64）
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  // 用户消息
  messages.push({ role: 'user', content: userMessage });

  const response = await fetch(DOUBAO_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`豆包LLM API错误: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * File 对象转 base64 data URI
 */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:${file.type || 'image/png'};base64,${base64}`;
}

/**
 * POST /api/prompt-reverse
 *
 * 电商主图提示词生成接口
 * 完整复刻 ComfyUI 工作流：产品图 + 风格参考图 → 视觉反推 → LLM融合 → 最终提示词
 *
 * 参数（multipart/form-data）：
 *   productImage  (File)   必填 - 产品图
 *   styleImage    (File)   可选 - 风格参考图（无则用产品图代替）
 *   productInfo   (string) 可选 - 产品信息与角色设定（对应 node 64，作为系统提示词）
 *   mainText      (string) 可选 - 海报文案（对应 node 65）
 *   imageRules    (string) 可选 - 生图限制规则（对应 node 67，拼接到最终提示词前面）
 */
export async function POST(request: NextRequest) {
  try {
    // ---- 1. 读取 API Key ----
    const apiKey = process.env.DOUBAO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: '未配置 DOUBAO_API_KEY，请在 .env.local 中设置' },
        { status: 500 }
      );
    }

    // ---- 2. 解析表单数据 ----
    const formData = await request.formData();

    const productImage = formData.get('productImage') as File | null;
    const styleImage = formData.get('styleImage') as File | null;
    const productInfo = (formData.get('productInfo') as string) || '';
    const mainText = (formData.get('mainText') as string) || '';
    const imageRules = (formData.get('imageRules') as string) || '';

    if (!productImage) {
      return NextResponse.json(
        { error: 'productImage 为必填参数' },
        { status: 400 }
      );
    }

    // ---- 3. 图片转 base64 ----
    const productImageBase64 = await fileToBase64(productImage);
    const styleImageBase64 = styleImage
      ? await fileToBase64(styleImage)
      : null;

    // ---- 4. 视觉反推：产品图描述（对应 node 6）----
    const productPrompt = await callDoubaoVision(
      productImageBase64,
      '描述图片的内容，包含图片的构图以及角度，以及产品的材质和组合效果，图片风格以及效果和镜头景别等信息，越详细越好。',
      apiKey
    );

    // ---- 5. 视觉反推：风格分析（对应 node 43）----
    const stylePrompt = await callDoubaoVision(
      styleImageBase64 || productImageBase64,
      '分析图片的风格，如配色、字体等，越详细越好',
      apiKey
    );

    // ---- 6. 文本拼接（复刻工作流 node 46/7/52/49/54 的逻辑）----
    // node 46: "text1:\n" + 产品描述
    const text1 = `text1:\n${productPrompt}`;
    // node 7: "text2" + 海报文案
    const text2 = `text2\n${mainText}`;
    // node 52: "text3:\n" + 风格分析
    const text3 = `text3:\n${stylePrompt}`;
    // node 49: 三段拼接
    const combinedText = `${text1}\n${text2}\n${text3}`;
    // node 54: 拼接 LLM 指令
    const userMessage =
      `${combinedText}\n` +
      `将text3中的文案内容修改成text1的文案。\n` +
      `将text3中的风格内容修改成text2的风格。\n` +
      `最后输出text3。`;

    // ---- 7. 调用豆包 LLM（对应 node 20）----
    const llmResponse = await callDoubaoChat(productInfo, userMessage, apiKey);

    // ---- 8. 最终提示词 = 生图规则 + LLM输出（对应 node 56: node67 + node20）----
    const finalPrompt = imageRules
      ? `${imageRules}\n${llmResponse}`
      : llmResponse;

    // ---- 9. 返回结果 ----
    return NextResponse.json({
      success: true,
      data: {
        productPrompt,   // 产品图反推描述
        stylePrompt,     // 风格参考图分析
        llmResponse,     // LLM 融合改写结果
        finalPrompt,     // 最终生图提示词（含规则）
      },
    });
  } catch (error) {
    console.error('提示词生成失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '服务器内部错误',
      },
      { status: 500 }
    );
  }
}
