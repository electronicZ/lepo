import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const imageUrl = request.nextUrl.searchParams.get('url');
  const filenameParam = request.nextUrl.searchParams.get('filename');

  if (!imageUrl) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 });
  }

  let remoteUrl: URL;
  try {
    remoteUrl = new URL(imageUrl);
  } catch {
    return NextResponse.json({ error: '无效的图片地址' }, { status: 400 });
  }

  if (!['http:', 'https:'].includes(remoteUrl.protocol)) {
    return NextResponse.json({ error: '仅支持 http/https 图片地址' }, { status: 400 });
  }

  try {
    const upstream = await fetch(remoteUrl.toString());
    if (!upstream.ok) {
      return NextResponse.json({ error: '拉取图片失败' }, { status: upstream.status });
    }

    const blob = await upstream.blob();
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const filename = filenameParam?.trim() || 'ai-image.png';

    return new NextResponse(blob, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: '下载失败' }, { status: 500 });
  }
}
