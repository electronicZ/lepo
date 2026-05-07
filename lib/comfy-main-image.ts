import template from './main-image-workflow-template.json';

export type ComfyWorkflow = Record<string, Record<string, unknown>>;

export function buildMainImageWorkflow(opts: {
  prompt: string;
  imageNames: [string, string, string, string];
  aspectRatio: string;
  resolution: string;
  seed: number;
}): ComfyWorkflow {
  const wf = JSON.parse(JSON.stringify(template)) as ComfyWorkflow;

  (wf['8'].inputs as Record<string, string>).image = opts.imageNames[0];
  (wf['44'].inputs as Record<string, string>).image = opts.imageNames[1];
  (wf['45'].inputs as Record<string, string>).image = opts.imageNames[2];
  (wf['64'].inputs as Record<string, string>).image = opts.imageNames[3];

  const n56 = wf['56'].inputs as Record<string, unknown>;
  n56.prompt = opts.prompt;
  n56.aspectRatio = opts.aspectRatio;
  n56.resolution = opts.resolution;
  n56.seed = opts.seed;

  return wf;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

export function comfyAuthHeaders(): HeadersInit {
  const key = process.env.COMFYUI_API_KEY?.trim();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

export async function comfyUploadImage(
  baseUrl: string,
  file: File,
  extraHeaders: HeadersInit
): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  form.append('type', 'input');
  form.append('overwrite', 'true');

  const res = await fetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    headers: extraHeaders,
    body: form,
  });

  const data = (await res.json()) as { name?: string; error?: string; detail?: string };
  if (!res.ok) {
    throw new Error(data.error || data.detail || `ComfyUI 上传失败 HTTP ${res.status}`);
  }
  if (!data.name) {
    throw new Error('ComfyUI 上传未返回文件名');
  }
  return data.name;
}

type HistoryEntry = {
  status?: { completed?: boolean; status_str?: string };
  outputs?: Record<
    string,
    { images?: Array<{ filename: string; subfolder?: string; type?: string }> }
  >;
};

export function extractSaveImageViewUrl(
  baseUrl: string,
  entry: HistoryEntry | undefined
): string | null {
  const imgs = entry?.outputs?.['42']?.images;
  const img = imgs?.[0];
  if (!img?.filename) return null;
  const sub = img.subfolder ?? '';
  const type = img.type ?? 'output';
  const q = new URLSearchParams({
    filename: img.filename,
    subfolder: sub,
    type,
  });
  return `${baseUrl}/view?${q.toString()}`;
}

export async function comfyGetHistoryEntry(
  baseUrl: string,
  promptId: string,
  headers: HeadersInit
): Promise<HistoryEntry | undefined> {
  let res = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { headers });
  if (res.ok) {
    const data = (await res.json()) as Record<string, HistoryEntry>;
    return data[promptId];
  }

  res = await fetch(`${baseUrl}/history`, { headers });
  if (!res.ok) return undefined;
  const all = (await res.json()) as Record<string, HistoryEntry>;
  return all[promptId];
}

export async function comfyQueuePrompt(
  baseUrl: string,
  workflow: ComfyWorkflow,
  headers: HeadersInit
): Promise<string> {
  const clientId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const h = new Headers(headers);
  h.set('Content-Type', 'application/json');

  const res = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      prompt: workflow,
      client_id: clientId,
    }),
  });

  const data = (await res.json()) as {
    prompt_id?: string;
    error?: string;
    detail?: string;
  };

  if (!res.ok) {
    throw new Error(data.error || data.detail || `ComfyUI /prompt 失败 HTTP ${res.status}`);
  }
  if (!data.prompt_id) {
    throw new Error(`ComfyUI 未返回 prompt_id: ${JSON.stringify(data)}`);
  }
  return data.prompt_id;
}

export async function comfyWaitForOutput(
  baseUrl: string,
  promptId: string,
  headers: HeadersInit,
  opts?: { maxAttempts?: number; intervalMs?: number }
): Promise<string> {
  const maxAttempts = opts?.maxAttempts ?? 180;
  const intervalMs = opts?.intervalMs ?? 2000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const entry = await comfyGetHistoryEntry(baseUrl, promptId, headers);
    const url = extractSaveImageViewUrl(baseUrl, entry);
    if (url) return url;

  }

  throw new Error('ComfyUI 生成超时，请稍后在工作流界面查看队列');
}
