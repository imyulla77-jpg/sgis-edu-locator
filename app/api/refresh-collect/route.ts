// POST /api/refresh-collect — 상세 페이지 몇 개(최대 4개)를 수집해 돌려준다 (DESIGN.md 7장, PLAN 작업 7)
// 입력: { pages: PageTarget[] }   출력: { results: PageResult[] }   오류: { error } (화면에 그대로 보여 줘도 되는 문장)
// 시간 한도(100초)를 넘기면 남은 페이지는 "시간 초과"로 돌려준다(refresh-collect.ts).
// 1판의 /api/collect는 2026-10-15 화면 교체 때 trash-can으로 옮겼다.

import { BrowserNotFoundError } from '@/lib/browser';
import { collectPages, isDetailPage, MAX_PAGES_PER_REQUEST } from '@/lib/refresh-collect';
import { COURSES, type PageTarget } from '@/lib/refresh-types';
import { passwordResponse } from '@/lib/run-password';
import { BROWSER_BUSY_MESSAGE, BROWSER_SLOTS, busyResponse, crossSiteResponse, tryAcquire } from '@/lib/server-limit';
import { isCollectablePage } from '@/lib/url';

/** 최대 실행 시간(초). 요청 시간 한도(100초) + 브라우저 닫기 여유 */
export const maxDuration = 120;

const LEVEL2 = ['수업하기', '스스로하기', '주제보기'];

/** 받은 페이지 목록이 올바른지 확인한다. 문제가 있으면 안내 문장, 없으면 null */
function checkPages(pages: unknown): string | null {
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > MAX_PAGES_PER_REQUEST) {
    return `한 번에 1~${MAX_PAGES_PER_REQUEST}페이지만 수집할 수 있어요`;
  }
  for (const p of pages as Partial<PageTarget>[]) {
    // 검색 대상 상세 페이지 주소만 연다(CHECK.md SEC-001)
    if (!p || typeof p.openUrl !== 'string' || !isDetailPage(p.openUrl)) return 'SGIS에듀 상세 페이지 주소만 수집할 수 있어요';
    if (p.contentsId !== null && typeof p.contentsId !== 'string') return '수집 페이지 형식이 올바르지 않아요';
    if (!Array.isArray(p.locations) || p.locations.length === 0) return '수집 페이지 형식이 올바르지 않아요';
    for (const l of p.locations) {
      const ok =
        l && COURSES.includes(l.course) && LEVEL2.includes(l.level2) && typeof l.level3 === 'string' && l.level3.length <= 100 &&
        typeof l.url === 'string' && isCollectablePage(l.url);
      if (!ok) return '수집 페이지 형식이 올바르지 않아요';
    }
  }
  return null;
}

export async function POST(request: Request) {
  // 다른 웹사이트가 몰래 보낸 요청은 거절한다(CHECK.md SEC-003)
  const crossSite = crossSiteResponse(request);
  if (crossSite) return crossSite;
  // 배포본에서는 실행 비밀번호가 있어야 한다(CHECK.md SEC-004)
  const wrongPassword = passwordResponse(request);
  if (wrongPassword) return wrongPassword;

  const body = await request.json().catch(() => null);
  const problem = checkPages(body?.pages);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  // 서버 브라우저는 대상 찾기·수집을 합쳐 한 번에 1개만 띄운다(CHECK.md SEC-002)
  const release = tryAcquire('browser', BROWSER_SLOTS);
  if (!release) return busyResponse(BROWSER_BUSY_MESSAGE);
  try {
    return Response.json({ results: await collectPages(body.pages as PageTarget[]) });
  } catch (error) {
    if (error instanceof BrowserNotFoundError) return Response.json({ error: error.message }, { status: 500 });
    console.error('[api/refresh-collect]', error);
    return Response.json({ error: '수집 중 문제가 생겼어요' }, { status: 500 });
  } finally {
    release();
  }
}
