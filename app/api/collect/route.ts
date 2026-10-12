// POST /api/collect — 묶음 하나(최대 6페이지)를 수집해 돌려준다 (DESIGN.md 7장, PLAN 작업 15b)
// 입력: { batch }   출력: { results }   오류: { error } (화면에 그대로 보여 줘도 되는 문장)
// 묶음 시간 한도(100초)를 넘기면 남은 페이지는 "시간 초과"로 돌려준다(collect.ts).

import { BrowserNotFoundError } from '@/lib/browser';
import { collectBatch } from '@/lib/collect';
import { MAX_PAGES_PER_BATCH } from '@/lib/menus';
import { BROWSER_BUSY_MESSAGE, BROWSER_SLOTS, busyResponse, crossSiteResponse, tryAcquire } from '@/lib/server-limit';
import { COURSES, type Batch } from '@/lib/types';
import { isAllowedUrl, URL_ERROR_MESSAGE } from '@/lib/url';

/** 최대 실행 시간(초). 묶음 시간 한도(100초) + 브라우저 닫기 여유 */
export const maxDuration = 120;

/** 받은 묶음이 올바른 모양인지 확인한다. 문제가 있으면 안내 문장, 없으면 null */
function checkBatch(batch: unknown): string | null {
  const b = batch as Partial<Batch> | null;
  if (!b || typeof b.id !== 'string' || typeof b.label !== 'string' || !Array.isArray(b.pages)) {
    return '수집 묶음 형식이 올바르지 않아요';
  }
  if (b.pages.length === 0 || b.pages.length > MAX_PAGES_PER_BATCH) {
    return `묶음 하나에는 1~${MAX_PAGES_PER_BATCH}페이지만 넣을 수 있어요`;
  }
  for (const page of b.pages) {
    if (!page || !COURSES.includes(page.course) || typeof page.menu !== 'string') return '수집 묶음 형식이 올바르지 않아요';
    // sgis.mods.go.kr이 아닌 주소는 열지 않는다(DESIGN.md 7·10장)
    if (typeof page.url !== 'string' || !isAllowedUrl(page.url)) return URL_ERROR_MESSAGE;
  }
  return null;
}

export async function POST(request: Request) {
  // 다른 웹사이트가 몰래 보낸 요청은 거절한다(CHECK.md SEC-003)
  const crossSite = crossSiteResponse(request);
  if (crossSite) return crossSite;

  const body = await request.json().catch(() => null);
  const problem = checkBatch(body?.batch);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  // 서버 브라우저는 메뉴 읽기·수집을 합쳐 한 번에 1개만 띄운다(CHECK.md SEC-001)
  const release = tryAcquire('browser', BROWSER_SLOTS);
  if (!release) return busyResponse(BROWSER_BUSY_MESSAGE);
  try {
    return Response.json({ results: await collectBatch(body.batch as Batch) });
  } catch (error) {
    if (error instanceof BrowserNotFoundError) return Response.json({ error: error.message }, { status: 500 });
    console.error('[api/collect]', error);
    return Response.json({ error: '수집 중 문제가 생겼어요' }, { status: 500 });
  } finally {
    release();
  }
}
