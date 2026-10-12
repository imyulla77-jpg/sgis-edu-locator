// GET /api/image?url=… — sgis.mods.go.kr 그림을 대신 받아 전달한다 (PRD nice 2, PLAN 작업 26, DESIGN.md 16장)
// 엑셀은 브라우저에서 만드는데, 브라우저는 보안 규칙(CORS) 때문에 다른 사이트의 그림을 바로 읽지 못할 수 있다.
// 그래서 같은 사이트(우리 서버)를 거쳐 그림을 받는다.
// 앱이 다른 사이트를 대신 여는 통로가 되지 않도록 sgis.mods.go.kr 주소만, 그림만, 10MB까지만 전달한다(DESIGN.md 10장).

import { busyResponse, crossSiteResponse, IMAGE_BUSY_MESSAGE, IMAGE_SLOTS, tryAcquire } from '@/lib/server-limit';
import { isAllowedUrl, URL_ERROR_MESSAGE } from '@/lib/url';

/** 그림 하나를 받을 때 기다리는 최대 시간 (수집 때와 같은 10초) */
const IMAGE_TIMEOUT_MS = 10_000;

/** 전달하는 그림의 최대 크기. 초등 메인 배경(움직이는 그림 img_mainBg.gif)이 약 6.3MB라 10MB로 둔다 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const maxDuration = 15;

export async function GET(request: Request) {
  // 다른 웹사이트가 몰래 보낸 요청은 거절한다(CHECK.md SEC-003)
  const crossSite = crossSiteResponse(request);
  if (crossSite) return crossSite;

  const url = new URL(request.url).searchParams.get('url') ?? '';
  if (!isAllowedUrl(url)) return Response.json({ error: URL_ERROR_MESSAGE }, { status: 400 });

  // 그림 대신 받기는 한 번에 3개까지만(CHECK.md SEC-001)
  const release = tryAcquire('image', IMAGE_SLOTS);
  if (!release) return busyResponse(IMAGE_BUSY_MESSAGE);
  try {
    const response = await fetch(url, {
      // 다른 사이트로 넘겨주는(리다이렉트) 응답은 따라가지 않는다
      redirect: 'manual',
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      // 요청 머리말에는 영문만 쓸 수 있다
      headers: { 'User-Agent': 'Mozilla/5.0 (SGIS-Edu-Locator)' },
    });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('image/')) {
      return Response.json({ error: '그림을 받지 못했어요' }, { status: 502 });
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) return Response.json({ error: '그림이 너무 커요' }, { status: 413 });
    return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=600' } });
  } catch {
    return Response.json({ error: '그림을 받지 못했어요' }, { status: 502 });
  } finally {
    release();
  }
}
