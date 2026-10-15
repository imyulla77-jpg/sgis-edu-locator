// POST /api/targets — 검색 대상 페이지 목록과 홈페이지 4개 메뉴를 돌려준다 (DESIGN.md 7장, PLAN 작업 6)
// 입력: { startUrl }   출력: TargetList { pages, homeMenus, warnings }   오류: { error } (화면에 그대로 보여 줘도 되는 문장)

import { BrowserNotFoundError } from '@/lib/browser';
import { passwordResponse } from '@/lib/run-password';
import { BROWSER_BUSY_MESSAGE, BROWSER_SLOTS, busyResponse, crossSiteResponse, tryAcquire } from '@/lib/server-limit';
import { loadTargets, TargetsError } from '@/lib/targets';
import { isAllowedUrl, URL_ERROR_MESSAGE } from '@/lib/url';

/** 최대 실행 시간(초). 대상 찾기 전체 한도(100초)보다 조금 길게 둔다 */
export const maxDuration = 120;

export async function POST(request: Request) {
  // 다른 웹사이트가 몰래 보낸 요청은 거절한다(CHECK.md SEC-003)
  const crossSite = crossSiteResponse(request);
  if (crossSite) return crossSite;
  // 배포본에서는 실행 비밀번호가 있어야 한다(CHECK.md SEC-004)
  const wrongPassword = passwordResponse(request);
  if (wrongPassword) return wrongPassword;

  const body = await request.json().catch(() => null);
  const startUrl = typeof body?.startUrl === 'string' ? body.startUrl : '';
  // 화면 검사를 건너뛰는 요청도 막는다(CHECK.md SEC-001)
  if (!isAllowedUrl(startUrl)) return Response.json({ error: URL_ERROR_MESSAGE }, { status: 400 });

  // 서버 브라우저는 대상 찾기·수집을 합쳐 한 번에 1개만 띄운다(CHECK.md SEC-002)
  const release = tryAcquire('browser', BROWSER_SLOTS);
  if (!release) return busyResponse(BROWSER_BUSY_MESSAGE);
  try {
    return Response.json(await loadTargets(startUrl));
  } catch (error) {
    if (error instanceof BrowserNotFoundError) return Response.json({ error: error.message }, { status: 500 });
    if (error instanceof TargetsError) return Response.json({ error: error.message }, { status: 503 });
    console.error('[api/targets]', error);
    return Response.json({ error: '검색 대상을 찾는 중 문제가 생겼어요' }, { status: 500 });
  } finally {
    release();
  }
}
