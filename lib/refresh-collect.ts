// [서버 전용] 상세 페이지 몇 개 수집 — 페이지 열기·재시도·시간 한도 (DESIGN.md 7장, PLAN 작업 7)
// 페이지가 열리면 refresh-extract.ts의 extractDetail로 그림·연도 문장을 읽고 캡처한 뒤, 그림 파일 지문(sha256)을 붙인다.
// - 한 번에 한 페이지씩, 페이지마다 1초 이상 쉬고 연다
// - 페이지당 최대 60초 기다리고, 실패하면 최대 2번 다시 시도 → 그래도 안 되면 "수집 실패"
// - 시작 후 100초가 지나면 새 페이지를 열지 않고 남은 페이지를 "시간 초과"로 돌려준다
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import { createHash } from 'node:crypto';
import type { Page } from 'playwright-core';
import { openPage, PAGE_TIMEOUT_MS, trace, withBrowser } from './browser.ts';
import { extractDetail } from './refresh-extract.ts';
import type { PageResult, PageTarget } from './refresh-types.ts';
import { isAllowedUrl } from './url.ts';

/** 요청 하나에 넣는 최대 페이지 수 (응답 크기가 Vercel 한도 4.5MB를 넘지 않게) */
export const MAX_PAGES_PER_REQUEST = 4;

/** 요청 하나의 시간 한도. 이 시간이 지나면 새 페이지를 열지 않는다(최대 실행 시간 120초 안에 응답하기 위함) */
export const COLLECT_TIME_LIMIT_MS = 100_000;

/** 처음 시도가 실패했을 때 다시 시도하는 횟수 (PRD must 1: 최대 2번) */
export const MAX_RETRIES = 2;

/** 페이지를 열기 전에 쉬는 시간 (PRD must 1: 1초 이상) */
export const PAGE_GAP_MS = 1_000;

/** 페이지를 열었더니 sgis.mods.go.kr 밖으로 넘어갔을 때의 실패 이유 */
export const OFF_SITE_MESSAGE = '허용되지 않은 주소로 넘어감';

/** 검색 대상 상세 페이지 주소 모양: 수업 상세(콘텐츠 번호) 또는 스스로하기 화면 */
const DETAIL_PATH = /^\/view\/edu\/(ele|mid|high)\/(classDetail|issueDetail|myself\/[A-Za-z]+)$/;

/** 상세 페이지 주소인지 확인한다(서버 API가 아무 페이지나 열지 않게, CHECK.md SEC-001) */
export function isDetailPage(url: string): boolean {
  if (!isAllowedUrl(url)) return false;
  const u = new URL(url.trim());
  if (!DETAIL_PATH.test(u.pathname)) return false;
  if (/Detail$/.test(u.pathname)) return /^[A-Z0-9_]{1,20}$/.test(u.searchParams.get('contents_id') ?? '');
  return u.search === '';
}

export interface CollectOptions {
  timeLimitMs?: number;
  pageTimeoutMs?: number;
  gapMs?: number;
  maxRetries?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 그림 파일 하나를 받을 때 기다리는 최대 시간 */
const IMAGE_TIMEOUT_MS = 10_000;

/**
 * 그림 파일을 받아 파일 지문(sha256)을 만든다. 받지 못하면 null(그 그림은 주소별로 따로 판단된다).
 * sgis.mods.go.kr 밖의 그림은 받지 않고, 다른 주소로 넘겨주는 응답은 따라가지 않는다.
 */
async function fingerprint(page: Page, src: string, timeoutMs: number): Promise<string | null> {
  if (!isAllowedUrl(src)) return null;
  try {
    const response = await page.request.get(src, { timeout: timeoutMs, maxRedirects: 0 });
    if (!response.ok()) return null;
    return createHash('sha256').update(await response.body()).digest('hex');
  } catch {
    return null;
  }
}

type Attempt =
  | { ok: true; result: Omit<PageResult, 'target' | 'status' | 'seconds'> & { title: string } }
  | { ok: false; error: string; cutByLimit: boolean };

/** 페이지를 한 번 열어 읽어 본다. 기다리는 시간은 60초와 남은 시간 중 짧은 쪽 */
async function tryOpen(page: Page, target: PageTarget, waitMs: number, limitedByTime: boolean, deadline: number): Promise<Attempt> {
  try {
    const t0 = Date.now();
    const response = await openPage(page, target.openUrl, waitMs);
    trace('open', target.openUrl, Date.now() - t0, 'ms');
    // 사이트가 다른 주소로 넘겨줬으면(다른 사이트, 또는 같은 사이트의 로그인·게시판 화면 등) 그 화면은 읽지 않는다(분석 G-11)
    if (!isDetailPage(page.url())) return { ok: false, error: OFF_SITE_MESSAGE, cutByLimit: false };
    if (response && response.status() >= 400) return { ok: false, error: `페이지 응답 오류(${response.status()})`, cutByLimit: false };
    const t1 = Date.now();
    const read = await extractDetail(page);
    trace('extract', target.openUrl, Date.now() - t1, 'ms', 'img', read.images.length, 'sent', read.sentences.length);
    // 그림이 하나도 없으면 화면이 덜 그려졌을 수 있어 한 번 더 시도한다
    if (read.images.length === 0) return { ok: false, error: '본문 그림을 찾지 못함', cutByLimit: false };
    // 그림 파일 지문: 주소가 달라도 내용이 같은 그림을 AI에 한 번만 보내기 위함(DESIGN.md 4장, 분석 G-01)
    //   요청 시간 한도가 2초 안으로 남으면 더 받지 않고 지문 없이 둔다(그 그림은 주소별로 판단됨, 분석 R-07)
    for (const image of read.images) {
      if (deadline - Date.now() < 2_000) break;
      image.sha256 = await fingerprint(page, image.src, Math.min(IMAGE_TIMEOUT_MS, deadline - Date.now() - 1_000));
    }
    return { ok: true, result: read };
  } catch (error) {
    trace('fail', target.openUrl, error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]}` : 'unknown');
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    if (isTimeout && limitedByTime) return { ok: false, error: '요청 시간 한도 초과', cutByLimit: true };
    // 오류 안내에는 기술 용어를 그대로 보여 주지 않는다
    return { ok: false, error: isTimeout ? `${Math.ceil(waitMs / 1000)}초 안에 열리지 않음` : '페이지를 열지 못함', cutByLimit: false };
  }
}

/** 상세 페이지 여러 개를 순서대로 수집한다. 결과는 받은 순서 그대로 돌려준다 */
export async function collectPages(targets: PageTarget[], options: CollectOptions = {}): Promise<PageResult[]> {
  const {
    timeLimitMs = COLLECT_TIME_LIMIT_MS,
    pageTimeoutMs = PAGE_TIMEOUT_MS,
    gapMs = PAGE_GAP_MS,
    maxRetries = MAX_RETRIES,
  } = options;
  const deadline = Date.now() + timeLimitMs;
  const timeLeft = () => deadline - Date.now();

  return withBrowser(async (browser) => {
    // 그림·문장 캡처 크기가 일정하도록 화면 크기를 고정한다
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const results: PageResult[] = [];

    for (const target of targets) {
      const started = Date.now();
      const empty = { images: [], sentences: [] };
      if (!isDetailPage(target.openUrl)) {
        results.push({ target, status: '수집 실패', error: '허용되지 않은 주소', ...empty, seconds: 0 });
        continue;
      }
      let result: PageResult | null = null;
      for (let attempt = 0; attempt <= maxRetries && !result; attempt++) {
        await sleep(gapMs);
        const seconds = () => Math.round((Date.now() - started) / 1000);
        if (timeLeft() <= 0) {
          result = { target, status: '시간 초과', error: '요청 시간 한도 초과', ...empty, seconds: seconds() };
          break;
        }
        const waitMs = Math.min(pageTimeoutMs, timeLeft());
        const outcome = await tryOpen(page, target, waitMs, waitMs < pageTimeoutMs, deadline);
        if (outcome.ok) {
          const { title, ...read } = outcome.result;
          // 제목: 목록 데이터의 제목 → (스스로하기처럼 메뉴 자체가 내용 화면이면) 3단계 메뉴 이름 → 페이지에서 읽은 제목
          const pageTitle = target.title || (target.contentsId === null ? target.locations[0]?.level3 : '') || title;
          result = { target: { ...target, title: pageTitle }, status: '성공', ...read, seconds: seconds() };
        } else if (outcome.cutByLimit) {
          result = { target, status: '시간 초과', error: outcome.error, ...empty, seconds: seconds() };
        } else if (attempt === maxRetries) {
          result = { target, status: '수집 실패', error: `${outcome.error} (${maxRetries + 1}번 시도)`, ...empty, seconds: seconds() };
        }
      }
      results.push(result!);
    }
    return results;
  });
}
