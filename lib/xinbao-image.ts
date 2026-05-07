/**
 * 心宝（Xinbao）异步 GPT Image 生图
 * 参考：https://skills.sh/98624017/xinbao-api-skill/xinbao-api
 * - 异步入口：https://async.xinbao-ai.com
 * - 提交：POST /v1/images/generations（Bearer）
 * - 轮询：提交返回的 polling_url，或 GET /v1/tasks/{id}；多任务 POST /v1/tasks/batch-get
 */

export const XINBAO_ASYNC_BASE = 'https://async.xinbao-ai.com';

const IMGBB_UPLOAD = 'https://api.imgbb.com/1/upload';

export async function uploadFileToImgbb(file: File, imgbbKey: string): Promise<string> {
  const formData = new FormData();
  formData.append('image', file);
  const res = await fetch(`${IMGBB_UPLOAD}?key=${imgbbKey}`, { method: 'POST', body: formData });
  const data = await res.json();
  if (data.success) return data.data.url as string;
  throw new Error(`imgbb 上传失败: ${JSON.stringify(data.error)}`);
}

/** gpt-image-2-oai：像素尺寸 WxH */
export function mapAspectResolutionToSize(aspectRatio: string, resolution: string): string {
  const res = (resolution || '2k').toLowerCase();
  const edge = res === '1k' || res === '1024' ? 1024 : 2048;
  const r = (aspectRatio || '1:1').replace(/\s/g, '');

  const pick = (w: number, h: number) => `${w}x${h}`;
  if (r === '1:1') return pick(edge, edge);
  if (r === '16:9') return res === '1k' ? pick(1024, 576) : pick(2048, 1152);
  if (r === '9:16') return res === '1k' ? pick(576, 1024) : pick(1152, 2048);
  if (r === '4:3') return res === '1k' ? pick(1024, 768) : pick(2048, 1536);
  if (r === '3:4') return res === '1k' ? pick(768, 1024) : pick(1536, 2048);
  return pick(edge, edge);
}

function getModelEndpoint(model: string): { endpoint: string; modelName: string } {
  const m = model || 'gpt-image-2-oai';
  const map: Record<string, string> = {
    'gpt-image-2': 'gpt-image-2',
    'gpt-image-2-oai': 'gpt-image-2-oai',
    'gpt-image-1': 'gpt-image-1',
  };
  return {
    endpoint: `${XINBAO_ASYNC_BASE}/v1/images/generations`,
    modelName: map[m] || 'gpt-image-2-oai',
  };
}

export async function pollTaskResult(pollingUrl: string, apiKey: string): Promise<string[]> {
  const url = pollingUrl.startsWith('http') ? pollingUrl : `${XINBAO_ASYNC_BASE}${pollingUrl}`;
  // skill：提交后约 50s 再首次轮询；此处略缩短以兼顾体验
  await new Promise((r) => setTimeout(r, 8000));

  for (let retry = 0; retry < 60; retry++) {
    if (retry > 0) await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const pollData = await pollRes.json();

    const status = pollData.status as string | undefined;
    if (status === 'succeeded' || status === 'completed') {
      if (Array.isArray(pollData.result?.data)) {
        const urls = pollData.result.data
          .map((item: { url?: string }) => item.url)
          .filter(Boolean) as string[];
        if (urls.length > 0) return urls;
      }
      if (pollData.content_url) return [pollData.content_url as string];
      return [];
    }
    if (status === 'failed') {
      throw new Error(`图片生成失败: ${pollData.error?.message || '未知错误'}`);
    }
  }
  throw new Error('图片生成超时（约 5 分钟）');
}

export async function pollBatchResults(
  ids: string[],
  apiKey: string
): Promise<Map<string, string[]>> {
  const pending = new Set(ids);
  const results = new Map<string, string[]>();
  await new Promise((r) => setTimeout(r, 8000));

  for (let retry = 0; retry < 60; retry++) {
    if (pending.size === 0) break;
    if (retry > 0) await new Promise((r) => setTimeout(r, 5000));

    const batchRes = await fetch(`${XINBAO_ASYNC_BASE}/v1/tasks/batch-get`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: Array.from(pending) }),
    });
    const batchData = await batchRes.json();
    const items: Array<Record<string, unknown>> = (batchData.items as Array<Record<string, unknown>>) || [];

    for (const item of items) {
      const id = item.id as string;
      const status = item.status as string;
      if (status === 'succeeded' || status === 'completed') {
        const urls: string[] = [];
        const resultData = (item.result as { data?: Array<{ url?: string }> } | undefined)?.data;
        if (Array.isArray(resultData)) {
          resultData.forEach((d) => {
            if (d.url) urls.push(d.url);
          });
        }
        results.set(id, urls);
        pending.delete(id);
      } else if (status === 'failed') {
        results.set(id, []);
        pending.delete(id);
      }
    }
  }
  return results;
}

export type SubmitImageTaskOptions = {
  prompt: string;
  /** 参考图公网 URL，建议 6 张以内；skill 说明可传 image 数组 */
  imageUrls: string[];
  size: string;
  apiKey: string;
  model: string;
  quality: string;
};

export async function submitImageTask(
  opts: SubmitImageTaskOptions
): Promise<{ id: string; pollingUrl: string }> {
  const { endpoint, modelName } = getModelEndpoint(opts.model);
  const validQualities = ['low', 'medium', 'high'];
  const q = validQualities.includes(opts.quality) ? opts.quality : 'medium';

  const requestBody: Record<string, unknown> = {
    model: modelName,
    prompt: opts.prompt,
    response_format: 'url',
    size: /^\d+x\d+$/.test(opts.size) ? opts.size : '1024x1024',
    quality: q,
  };

  if (opts.imageUrls.length === 1) {
    requestBody.image = opts.imageUrls[0];
  } else if (opts.imageUrls.length > 1) {
    requestBody.image = opts.imageUrls;
  }

  const submitRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const submitData = await submitRes.json();
  if (!submitRes.ok) {
    throw new Error(`心宝 API 提交失败: ${submitRes.status} ${JSON.stringify(submitData)}`);
  }
  const id = submitData.id as string | undefined;
  const pollingUrl =
    (submitData.polling_url as string) || (id ? `${XINBAO_ASYNC_BASE}/v1/tasks/${id}` : '');
  if (!id) throw new Error('未获取到任务 ID: ' + JSON.stringify(submitData));
  return { id, pollingUrl };
}
