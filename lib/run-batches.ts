// 수집 지휘 — 묶음을 차례로 보내고 진행 상황을 알린다 (DESIGN.md 5장 ③·7장·9장, PLAN 작업 13·15c)
// 개발용 실행(scripts/collect-dev.ts)과 화면(app/page.tsx)이 함께 쓴다.
// 묶음을 실제로 수집하는 방법(send)은 부르는 쪽이 넘긴다:
//   - 개발용 실행: lib/collect.ts의 collectBatch를 바로 부름
//   - 화면: 서버 API /api/collect에 보냄
// 브라우저 없이 동작하므로 화면에서도 불러올 수 있다.
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import { isSiteUnavailable } from './site-check.ts';
import type { Batch, Course, PageResult } from './types.ts';
import { COURSES } from './types.ts';

/** 묶음과 묶음 사이에 쉬는 시간 (DESIGN.md 7장: 1초 이상) */
export const BATCH_GAP_MS = 1_000;

/** 다시 보낼 때 묶음 하나에 넣는 최대 페이지 수 (DESIGN.md 2장 C안) */
const MAX_PAGES_PER_BATCH = 6;

/** 묶음 하나를 수집해 페이지 결과를 돌려주는 함수 */
export type SendBatch = (batch: Batch) => Promise<PageResult[]>;

/** 과정 하나의 진행 상황 */
export interface CourseProgress {
  course: Course;
  donePages: number;
  totalPages: number;
}

/** 진행 상황 */
export interface RunProgress {
  /** 결과를 받은 페이지 수 (다시 보낸 페이지는 한 번만 센다) */
  donePages: number;
  totalPages: number;
  failedPages: number;
  /** 지금 보내는 묶음 이름. 예: "중학 > 주제보기" */
  current: string;
  /** 지금 보내는 묶음의 페이지 수 */
  currentPages: number;
  /** 과정별 진행 상황 (초등 → 중학 → 고교) */
  courses: CourseProgress[];
}

export interface RunOptions {
  gapMs?: number;
  /** 묶음을 보내기 직전·결과를 받은 직후마다 불린다 */
  onProgress?: (progress: RunProgress) => void;
}

export interface RunOutcome {
  /** 수집 대상 순서대로 정리한 페이지 결과 */
  results: PageResult[];
  /** "처음 3페이지 연속 실패"로 전체를 멈췄는지 */
  stoppedAsUnavailable: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 묶음 하나를 보낸다. 보내기 자체가 실패하면(네트워크 오류·서버 응답 없음 등) 1번 더 보내고,
 * 그래도 안 되면 묶음의 페이지를 모두 "수집 실패"로 기록한다 (DESIGN.md 9장).
 * 앞 요청의 응답을 받은 뒤에만 다음 요청을 보내므로 같은 페이지를 동시에 두 번 열지 않는다.
 */
async function sendWithRetry(send: SendBatch, batch: Batch, gapMs: number): Promise<PageResult[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await send(batch);
    } catch {
      if (attempt === 0) await sleep(gapMs);
    }
  }
  return batch.pages.map((target) => ({ target, status: '수집 실패', error: '서버 응답 없음', items: [] }));
}

/** 페이지 목록을 최대 6개씩 묶는다 (다시 보낼 때 씀) */
function rebatch(results: PageResult[]): Batch[] {
  const batches: Batch[] = [];
  for (let i = 0; i < results.length; i += MAX_PAGES_PER_BATCH) {
    const pages = results.slice(i, i + MAX_PAGES_PER_BATCH).map((r) => r.target);
    batches.push({ id: `다시-${i / MAX_PAGES_PER_BATCH + 1}`, course: pages[0].course, label: '시간 초과 페이지 다시 수집', pages });
  }
  return batches;
}

/**
 * 묶음을 하나씩 차례로 보내 수집한다.
 * 1. 묶음 응답을 받으면 1초 이상 쉬고 다음 묶음을 보낸다
 * 2. 처음 3페이지가 연달아 실패하면 전체를 멈춘다 (site-check.ts)
 * 3. 다 보낸 뒤 "시간 초과" 페이지를 모아 맨 뒤에 1번만 다시 보낸다. 그래도 시간 초과면 "수집 실패"
 */
export async function runBatches(batches: Batch[], send: SendBatch, options: RunOptions = {}): Promise<RunOutcome> {
  const { gapMs = BATCH_GAP_MS, onProgress } = options;
  const totalPages = batches.reduce((sum, b) => sum + b.pages.length, 0);
  const results: PageResult[] = [];
  const isDone = (r: PageResult) => r.status !== '시간 초과'; // 시간 초과는 다시 보내므로 아직 안 끝난 것으로 센다
  const pagesOf = (course: Course) =>
    batches.filter((b) => b.course === course).reduce((sum, b) => sum + b.pages.length, 0);
  const report = (batch: Batch) =>
    onProgress?.({
      donePages: results.filter(isDone).length,
      totalPages,
      failedPages: results.filter((r) => r.status === '수집 실패').length,
      current: batch.label,
      currentPages: batch.pages.length,
      courses: COURSES.map((course) => ({
        course,
        donePages: results.filter((r) => r.target.course === course && isDone(r)).length,
        totalPages: pagesOf(course),
      })),
    });

  for (const [index, batch] of batches.entries()) {
    if (index > 0) await sleep(gapMs);
    report(batch);
    results.push(...(await sendWithRetry(send, batch, gapMs)));
    report(batch);
    if (isSiteUnavailable(results)) return { results, stoppedAsUnavailable: true };
  }

  // 시간 초과 페이지를 맨 뒤에 1번만 다시 보낸다
  const timedOut = results.filter((r) => r.status === '시간 초과');
  for (const batch of rebatch(timedOut)) {
    await sleep(gapMs);
    report(batch);
    const retried = await sendWithRetry(send, batch, gapMs);
    for (const result of retried) {
      const index = results.findIndex((r) => r.target.url === result.target.url && r.target.course === result.target.course);
      results[index] =
        result.status === '시간 초과'
          ? { ...result, status: '수집 실패', error: '시간 초과 (다시 시도해도 같음)' }
          : result;
    }
    report(batch);
  }
  return { results, stoppedAsUnavailable: false };
}
