// [화면] 서버 API로 수집하기 — 화면의 수집 지휘 (DESIGN.md 5장 ②③·7장·9장, PLAN 작업 15c)
// 1. /api/menus로 묶음 목록을 받고
// 2. lib/run-batches.ts의 지휘 순서대로 묶음을 하나씩 /api/collect에 보낸다
//    (앞 응답을 받은 뒤 1초 쉬고 다음 묶음, 처음 3페이지 연속 실패 시 멈춤, 시간 초과 페이지는 맨 뒤에 1번 더)
// 브라우저 조종은 하지 않으므로 화면에서 불러올 수 있다.

import { runBatches, type RunOptions, type RunOutcome } from './run-batches.ts';
import type { Batch, PageResult } from './types.ts';

/** 서버 응답을 기다리는 최대 시간. 묶음 API 최대 실행 시간(120초) + 여유 (DESIGN.md 7장) */
export const REQUEST_TIMEOUT_MS = 130_000;

/** 서버가 오류를 알려 줄 때 쓰는 오류. message는 화면에 그대로 보여 줘도 되는 문장이다 */
export class CollectRequestError extends Error {
  /** 서버가 돌려준 상태 코드 (응답이 없었으면 없음). 429면 서버가 앞 작업을 아직 하는 중 */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'CollectRequestError';
    this.status = status;
  }
}

/**
 * 서버 API에 JSON을 보내고 JSON 응답을 받는다. 130초 안에 응답이 없으면 포기한다.
 * base: 서버 주소. 화면에서는 비워 두고(같은 사이트), 시험할 때는 'http://localhost:3000' 등을 넣는다.
 */
async function postJson<T>(path: string, body: unknown, base = ''): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CollectRequestError(data?.error ?? '서버에서 문제가 생겼어요', response.status);
    return data as T;
  } catch (error) {
    if (error instanceof CollectRequestError) throw error;
    throw new CollectRequestError('서버가 응답하지 않아요'); // 시간 초과·네트워크 오류
  } finally {
    clearTimeout(timer);
  }
}

/** 15a: 묶음 목록 받기 */
export function fetchBatches(startUrl: string, base = ''): Promise<{ batches: Batch[]; totalPages: number }> {
  return postJson('/api/menus', { startUrl }, base);
}

/** 15b: 묶음 하나 수집 */
export async function sendBatch(batch: Batch, base = ''): Promise<PageResult[]> {
  const { results } = await postJson<{ results: PageResult[] }>('/api/collect', { batch }, base);
  return results;
}

/**
 * 이미 받은 묶음 목록(전체 또는 고른 메뉴만)을 서버 API로 차례로 수집한다 (PLAN 작업 25: 메뉴 골라서 수집).
 */
export async function collectBatches(
  batches: Batch[],
  options: RunOptions & { base?: string } = {},
): Promise<RunOutcome & { totalPages: number }> {
  const { base = '', ...runOptions } = options;
  const outcome = await runBatches(batches, (batch) => sendBatch(batch, base), runOptions);
  return { ...outcome, totalPages: batches.reduce((sum, b) => sum + b.pages.length, 0) };
}

/**
 * 15c: 시작 주소부터 전체 수집까지.
 * 묶음 목록을 받으면 onBatches로 알리고, 진행 상황은 onProgress로 알린다.
 * 메뉴 읽기가 실패하면 CollectRequestError(안내 문장 포함)를 던진다.
 */
export async function collectAll(
  startUrl: string,
  options: RunOptions & { base?: string; onBatches?: (info: { batches: Batch[]; totalPages: number }) => void } = {},
): Promise<RunOutcome & { totalPages: number }> {
  const { base = '', onBatches, ...runOptions } = options;
  const info = await fetchBatches(startUrl, base);
  onBatches?.(info);
  const outcome = await runBatches(info.batches, (batch) => sendBatch(batch, base), runOptions);
  return { ...outcome, totalPages: info.totalPages };
}
