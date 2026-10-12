// POST /api/menus — 메인 3개를 열어 수집 묶음 목록을 돌려준다 (DESIGN.md 7장, PLAN 작업 15a)
// 입력: { startUrl }   출력: { batches, totalPages }   오류: { error } (화면에 그대로 보여 줘도 되는 문장)

import { BrowserNotFoundError } from '@/lib/browser';
import { loadBatches, MenuError } from '@/lib/menus';
import { BROWSER_BUSY_MESSAGE, BROWSER_SLOTS, busyResponse, tryAcquire } from '@/lib/server-limit';
import { isAllowedUrl, URL_ERROR_MESSAGE } from '@/lib/url';

/** 최대 실행 시간(초). 메뉴 읽기 전체 한도(50초)보다 조금 길게 둔다 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const startUrl = typeof body?.startUrl === 'string' ? body.startUrl : '';
  // 화면 검사를 건너뛰는 요청도 막는다(DESIGN.md 7·10장)
  if (!isAllowedUrl(startUrl)) return Response.json({ error: URL_ERROR_MESSAGE }, { status: 400 });

  // 서버 브라우저는 메뉴 읽기·수집을 합쳐 한 번에 1개만 띄운다(CHECK.md SEC-001)
  const release = tryAcquire('browser', BROWSER_SLOTS);
  if (!release) return busyResponse(BROWSER_BUSY_MESSAGE);
  try {
    return Response.json(await loadBatches(startUrl));
  } catch (error) {
    if (error instanceof BrowserNotFoundError) return Response.json({ error: error.message }, { status: 500 });
    if (error instanceof MenuError) return Response.json({ error: error.message }, { status: 503 });
    console.error('[api/menus]', error);
    return Response.json({ error: '메뉴를 읽는 중 문제가 생겼어요' }, { status: 500 });
  } finally {
    release();
  }
}
