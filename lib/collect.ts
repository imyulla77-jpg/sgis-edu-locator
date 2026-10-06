// [서버 전용] 묶음 하나 수집 — 페이지 열기·재시도·시간 한도 (DESIGN.md 7장, PLAN 작업 6)
// 페이지가 열리면 extract.ts의 extractPageItems로 이미지·문구를 읽고(PLAN 작업 8),
// 그림 파일을 내려받아 파일 지문(해시)을 붙인다(PLAN 작업 10).
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import { createHash } from 'node:crypto';
import type { Page } from 'playwright-core';
import { openPage, PAGE_TIMEOUT_MS, withBrowser } from './browser.ts';
import { extractPageItems } from './extract.ts';
import type { Batch, PageResult, PageTarget, RawItem } from './types.ts';
import { isAllowedUrl } from './url.ts';

/** 묶음 하나의 시간 한도. 이 시간이 지나면 새 페이지를 열지 않는다(최대 실행 시간 120초 안에 응답하기 위함) */
export const BATCH_TIME_LIMIT_MS = 100_000;

/** 처음 시도가 실패했을 때 다시 시도하는 횟수 (PRD must 1: 최대 2번) */
export const MAX_RETRIES = 2;

/** 페이지를 열기 전에 쉬는 시간 (PRD must 1: 1초 이상) */
export const PAGE_GAP_MS = 1_000;

/** 그림 파일 하나를 내려받을 때 기다리는 최대 시간 */
export const IMAGE_TIMEOUT_MS = 10_000;

/** 열린 페이지에서 이미지·문구를 읽는 함수 (기본값: extractPageItems) */
export type Extractor = (page: Page, target: PageTarget) => Promise<RawItem[]>;

/** 수집 설정. 시험할 때 시간을 줄이려고 바꿀 수 있게 열어 둔다 */
export interface CollectOptions {
  extract?: Extractor;
  timeLimitMs?: number;
  pageTimeoutMs?: number;
  gapMs?: number;
  maxRetries?: number;
  imageTimeoutMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 그림 주소 → 파일 지문. 묶음 안에서 같은 주소는 한 번만 받는다. null = 받지 못함("비교 불가") */
type FingerprintCache = Map<string, string | null>;

/**
 * 그림 파일을 내려받아 파일 지문(SHA-256)을 만든다. 받지 못하면 null.
 * sgis.mods.go.kr 밖의 그림은 내려받지 않는다(앱이 다른 사이트에 요청을 보내지 않도록, DESIGN.md 10장).
 */
async function fingerprint(page: Page, url: string, waitMs: number): Promise<string | null> {
  if (!isAllowedUrl(url) || waitMs <= 0) return null;
  try {
    const response = await page.request.get(url, { timeout: waitMs });
    if (!response.ok()) return null;
    return createHash('sha256').update(await response.body()).digest('hex');
  } catch {
    return null;
  }
}

/** 이미지 항목에 파일 지문을 붙인다. 받지 못한 그림은 hash를 비워 둔다("비교 불가") */
async function addFingerprints(
  page: Page,
  items: RawItem[],
  cache: FingerprintCache,
  waitFor: () => number,
): Promise<RawItem[]> {
  const result: RawItem[] = [];
  for (const item of items) {
    if (item.kind !== '이미지') {
      result.push(item);
      continue;
    }
    let hash = cache.get(item.value);
    if (hash === undefined) {
      const waitMs = waitFor();
      hash = await fingerprint(page, item.value, waitMs);
      // 묶음 시간이 다 돼서 못 받은 경우는 저장하지 않는다(다음 묶음에서 다시 받을 수 있도록)
      if (waitMs > 0) cache.set(item.value, hash);
    }
    result.push(hash ? { ...item, hash } : item);
  }
  return result;
}

/** 한 번의 시도 결과 */
type Attempt = { ok: true; items: RawItem[] } | { ok: false; error: string; cutByLimit: boolean };

/** 페이지를 한 번 열어 본다. 기다리는 시간은 60초와 남은 묶음 시간 중 짧은 쪽 */
async function tryOpen(
  page: Page,
  target: PageTarget,
  waitMs: number,
  limitedByBatch: boolean,
  extract: Extractor,
): Promise<Attempt> {
  try {
    const response = await openPage(page, target.url, waitMs);
    if (response && response.status() >= 400) {
      return { ok: false, error: `페이지 응답 오류(${response.status()})`, cutByLimit: false };
    }
    return { ok: true, items: await extract(page, target) };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    if (isTimeout && limitedByBatch) return { ok: false, error: '묶음 시간 한도 초과', cutByLimit: true };
    // 오류 안내에는 기술 용어를 그대로 보여 주지 않는다(DESIGN.md 9장)
    return {
      ok: false,
      error: isTimeout ? `${Math.ceil(waitMs / 1000)}초 안에 열리지 않음` : '페이지를 열지 못함',
      cutByLimit: false,
    };
  }
}

/**
 * 묶음 하나를 수집한다.
 * - 한 번에 한 페이지씩, 페이지마다 1초 이상 쉬고 연다
 * - 페이지당 최대 60초 기다리고, 실패하면 최대 2번 다시 시도 → 그래도 안 되면 "수집 실패"
 * - 시작 후 100초가 지나면 새 페이지를 열지 않고 남은 페이지를 "시간 초과"로 돌려준다
 * - 결과는 묶음의 페이지 순서 그대로 돌려준다
 */
export async function collectBatch(batch: Batch, options: CollectOptions = {}): Promise<PageResult[]> {
  const {
    extract = extractPageItems,
    timeLimitMs = BATCH_TIME_LIMIT_MS,
    pageTimeoutMs = PAGE_TIMEOUT_MS,
    gapMs = PAGE_GAP_MS,
    maxRetries = MAX_RETRIES,
    imageTimeoutMs = IMAGE_TIMEOUT_MS,
  } = options;

  const deadline = Date.now() + timeLimitMs;
  const timeLeft = () => deadline - Date.now();

  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    const results: PageResult[] = [];
    const cache: FingerprintCache = new Map();
    const imageWait = () => Math.min(imageTimeoutMs, timeLeft());

    for (const target of batch.pages) {
      // sgis.mods.go.kr 주소가 아니면 열지 않는다(DESIGN.md 10장)
      if (!isAllowedUrl(target.url)) {
        results.push({ target, status: '수집 실패', error: '허용되지 않은 주소', items: [] });
        continue;
      }

      let result: PageResult | null = null;
      for (let attempt = 0; attempt <= maxRetries && !result; attempt++) {
        await sleep(gapMs);
        if (timeLeft() <= 0) {
          result = { target, status: '시간 초과', error: '묶음 시간 한도 초과', items: [] };
          break;
        }
        const waitMs = Math.min(pageTimeoutMs, timeLeft());
        const outcome = await tryOpen(page, target, waitMs, waitMs < pageTimeoutMs, extract);
        if (outcome.ok) {
          result = { target, status: '성공', items: await addFingerprints(page, outcome.items, cache, imageWait) };
        } else if (outcome.cutByLimit) {
          result = { target, status: '시간 초과', error: outcome.error, items: [] };
        } else if (attempt === maxRetries) {
          result = { target, status: '수집 실패', error: `${outcome.error} (${maxRetries + 1}번 시도)`, items: [] };
        }
      }
      results.push(result!);
    }
    return results;
  });
}
