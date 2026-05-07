import { NextRequest, NextResponse } from 'next/server';
import {
  mapAspectResolutionToSize,
  pollBatchResults,
  pollTaskResult,
  submitImageTask,
  uploadFileToImgbb,
} from '@/lib/xinbao-image';

/**
 * POST /api/image-generation
 *
 * 心宝（Xinbao）异步 GPT Image，与官方 skill 路由一致：
 * https://skills.sh/98624017/xinbao-api-skill/xinbao-api
 *
 * - Base：`https://async.xinbao-ai.com`
 * - 提交：`POST /v1/images/generations` + `Authorization: Bearer <XINBAO_API_KEY>`
 * - 轮询：响应中的 `polling_url`，或多任务 `POST /v1/tasks/batch-get`
 *
 * 环境变量：
 *   XINBAO_API_KEY   必填
 *   IMGBB_API_KEY    有参考图时必填（上传公网 URL 供图生图）
 *
 * multipart/form-data：
 *   prompt, image1…image4（参考图，1～4 张；仅填有的会加入 image 数组）
 *   aspect_ratio, resolution → 映射为 gpt-image-2-oai 的 size（WxH）
 *   num_images（1–10）, quality（low|medium|high，默认 medium）
 *   model（默认 gpt-image-2-oai）
 */

const XINBAO_API_KEY = process.env.XINBAO_API_KEY || '';
const IMGBB_KEY = process.env.IMGBB_API_KEY || '';

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: '请使用 multipart/form-data 上传' }, { status: 400 });
    }

    const formData = await request.formData();
    const prompt = (formData.get('prompt') as string)?.trim();
    if (!prompt) {
      return NextResponse.json({ error: 'prompt 为必填' }, { status: 400 });
    }

    if (!XINBAO_API_KEY) {
      return NextResponse.json(
        { error: '未配置 XINBAO_API_KEY，请在 .env.local 设置心宝 API Key' },
        { status: 500 }
      );
    }

    const aspectRatio = ((formData.get('aspect_ratio') as string) || '1:1').trim();
    const resolution = ((formData.get('resolution') as string) || '2k').trim();
    const size = mapAspectResolutionToSize(aspectRatio, resolution);
    const model = ((formData.get('model') as string) || 'gpt-image-2-oai').trim();
    const quality = ((formData.get('quality') as string) || 'medium').trim();

    let numImages = parseInt((formData.get('num_images') as string) || '1', 10);
    if (Number.isNaN(numImages)) numImages = 1;
    numImages = Math.max(1, Math.min(numImages, 10));

    const files: File[] = [];
    for (let i = 1; i <= 4; i++) {
      const f = formData.get(`image${i}`);
      if (f instanceof File && f.size > 0) files.push(f);
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: '请至少上传一张参考图（image1～image4）' },
        { status: 400 }
      );
    }

    if (!IMGBB_KEY) {
      return NextResponse.json(
        { error: '图生图需要 IMGBB_API_KEY，请在 .env.local 配置 imgbb 用于上传参考图' },
        { status: 500 }
      );
    }

    const imageUrls: string[] = [];
    for (const file of files) {
      try {
        imageUrls.push(await uploadFileToImgbb(file, IMGBB_KEY));
      } catch (err) {
        return NextResponse.json(
          { error: `参考图上传图床失败: ${err instanceof Error ? err.message : String(err)}` },
          { status: 500 }
        );
      }
    }

    const allImages: { index: number; url: string }[] = [];

    if (numImages === 1) {
      const { pollingUrl } = await submitImageTask({
        prompt,
        imageUrls,
        size,
        apiKey: XINBAO_API_KEY,
        model,
        quality,
      });
      const urls = await pollTaskResult(pollingUrl, XINBAO_API_KEY);
      if (urls.length === 0) throw new Error('生成结果为空');
      allImages.push({ index: 0, url: urls[0] });
    } else {
      const taskIds: string[] = [];
      for (let i = 0; i < numImages; i++) {
        const { id } = await submitImageTask({
          prompt,
          imageUrls,
          size,
          apiKey: XINBAO_API_KEY,
          model,
          quality,
        });
        taskIds.push(id);
        if (i < numImages - 1) await new Promise((r) => setTimeout(r, 500));
      }
      const batchResults = await pollBatchResults(taskIds, XINBAO_API_KEY);
      for (let i = 0; i < taskIds.length; i++) {
        const urls = batchResults.get(taskIds[i]) || [];
        if (urls.length === 0) throw new Error(`第 ${i + 1} 张图片生成失败或结果为空`);
        allImages.push({ index: i, url: urls[0] });
      }
    }

    return NextResponse.json({ success: true, images: allImages });
  } catch (error) {
    console.error('[xinbao image-generation]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器内部错误' },
      { status: 500 }
    );
  }
}
