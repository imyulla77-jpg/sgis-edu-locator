// [화면] 진행 지휘 — 대상 찾기 → 페이지 수집 → AI 판단 → 시트 1 행 (DESIGN.md 1·7·8장, PLAN 작업 15)
// 서버 API를 차례로 부르고 진행 상황을 알린다. 브라우저 조종·AI 호출은 서버가 하고, 여기서는 순서만 정한다.
// - 수집: 첫 요청 3페이지, 그 뒤 4페이지씩. 앞 응답을 받은 뒤 1초 쉬고 다음 요청. 처음 3페이지 연속 실패면 전체를 멈춘다.
//         "시간 초과" 페이지는 맨 뒤에 1번만 다시 보낸다
// - AI 판단: 파일 내용(지문)이 같은 그림은 한 번만(lib/judge-plan.ts), 한 번에 3개까지
// - 서버가 "앞 작업 중"(429)이면 실패로 세지 않고 5초씩 쉬며 최대 150초까지 다시 보낸다
// 실행 비밀번호는 메모리에만 두고 머리말로 보낸다(저장하지 않음).
//
// 화면에서 쓰지만 시험할 때 Node에서도 부를 수 있도록 lib 파일은 상대 경로 + .ts 확장자로 불러온다.

import { planJudging, spreadJudgements } from './judge-plan.ts';
import { buildRecords } from './records.ts';
import type { Judgement, PageResult, PageTarget, RecordRow, TargetList } from './refresh-types.ts';
import { FIRST_PAGES_TO_CHECK, isSiteUnavailable, SITE_UNAVAILABLE_MESSAGE } from './site-check.ts';

/** 한 번에 수집을 맡기는 페이지 수 (서버 MAX_PAGES_PER_REQUEST와 같게) */
const PAGES_PER_REQUEST = 4;

/** 요청과 요청 사이에 쉬는 시간 (PRD must 1: 1초 이상) */
const GAP_MS = 1_000;

/** 서버가 "앞 작업 중"(429)일 때 다시 보내기 전에 쉬는 시간 */
const BUSY_RETRY_MS = 5_000;

/** "앞 작업 중"이라 기다리는 최대 시간. 서버 최대 실행 시간(120초) + 여유 */
const BUSY_WAIT_LIMIT_MS = 150_000;

/** 서버 응답을 기다리는 최대 시간. 서버 최대 실행 시간(120초) + 여유 */
const REQUEST_TIMEOUT_MS = 130_000;

/** 한 번에 보내는 AI 판단 요청 수 (서버 JUDGE_SLOTS와 같게) */
const JUDGE_CONCURRENCY = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 서버가 오류를 알려 줄 때 쓰는 오류. message는 화면에 그대로 보여 줘도 되는 문장이다 */
export class RequestError extends Error {
  readonly status?: number;
  /** 실행 비밀번호가 필요하거나 틀렸는지(401) */
  readonly passwordRequired: boolean;
  constructor(message: string, status?: number, passwordRequired = false) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.passwordRequired = passwordRequired;
  }
}

export interface RunConfig {
  /** 실행 비밀번호 (배포본에서만 필요). 없으면 빈 글자 */
  password?: string;
  /** 서버 주소. 화면에서는 비워 두고(같은 사이트), 시험할 때는 'http://127.0.0.1:3000' 등 */
  base?: string;
}

/** 서버 API에 JSON을 보내고 JSON 응답을 받는다. 130초 안에 응답이 없으면 포기한다 */
async function postJson<T>(path: string, body: unknown, config: RunConfig): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.password) headers['x-run-password'] = config.password;
    const response = await fetch(`${config.base ?? ''}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new RequestError(data?.error ?? '서버에서 문제가 생겼어요', response.status, response.status === 401);
    }
    return data as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError('서버가 응답하지 않아요'); // 시간 초과·네트워크 오류
  } finally {
    clearTimeout(timer);
  }
}

/** 429(앞 작업 중)면 5초씩 쉬며 다시 보낸다(최대 150초). 다른 오류는 그대로 던진다 */
async function postPatiently<T>(path: string, body: unknown, config: RunConfig): Promise<T> {
  const deadline = Date.now() + BUSY_WAIT_LIMIT_MS;
  for (;;) {
    try {
      return await postJson<T>(path, body, config);
    } catch (error) {
      if (error instanceof RequestError && error.status === 429 && Date.now() + BUSY_RETRY_MS < deadline) {
        await sleep(BUSY_RETRY_MS);
        continue;
      }
      throw error;
    }
  }
}

/** 진행 상황 */
export type RunStep = '대상 찾기' | '페이지 수집' | 'AI 판단';
export interface RunProgress {
  step: RunStep;
  /** 대상 찾기는 아직 전체 수를 몰라 0 */
  done: number;
  total: number;
  /** 페이지 수집: 실패 페이지 수, AI 판단: 확인 필요 수 */
  problems: number;
}

/** 전체 실행 결과 */
export interface RunOutcome {
  startUrl: string;
  finishedAt: Date;
  targets: TargetList;
  results: PageResult[];
  judgements: Map<string, Judgement>;
  records: RecordRow[];
}

/** 페이지 몇 개를 수집한다. 보내기 자체가 실패하면 1번 더, 그래도 안 되면 모두 "수집 실패" */
async function collectChunk(pages: PageTarget[], config: RunConfig): Promise<PageResult[]> {
  let reason = '서버 응답 없음';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { results } = await postPatiently<{ results: PageResult[] }>('/api/refresh-collect', { pages }, config);
      return results;
    } catch (error) {
      if (error instanceof RequestError && error.passwordRequired) throw error; // 비밀번호 문제는 화면에서 다시 입력
      // 한글 안내 문장은 실패 이유로 남기고, 기술 용어일 수 있는 문장은 보여 주지 않는다
      if (error instanceof Error && /[가-힣]/.test(error.message)) reason = error.message;
      if (attempt === 0) await sleep(GAP_MS);
    }
  }
  return pages.map((target) => ({ target, status: '수집 실패', error: reason, images: [], sentences: [], seconds: 0 }));
}

/** 그림 하나를 판단한다. 서버가 판단하지 못하면 "확인 필요"로 남긴다(값을 지어내지 않음) */
async function judgeOne(src: string, config: RunConfig): Promise<Judgement> {
  try {
    return await postPatiently<Judgement>('/api/judge', { src }, config);
  } catch (error) {
    if (error instanceof RequestError && error.passwordRequired) throw error;
    const reason = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : 'AI 판단 요청 실패';
    return { src, sha256: null, years: [], maxYear: null, verdict: '확인 필요', model: null, error: reason };
  }
}

/**
 * 시작 주소부터 시트 1 행까지 전부 실행한다.
 * - 처음 3페이지가 연달아 실패하면 SITE_UNAVAILABLE_MESSAGE로 RequestError를 던진다
 * - 비밀번호가 필요하거나 틀리면 passwordRequired가 true인 RequestError를 던진다
 */
export async function runAll(startUrl: string, onProgress: (p: RunProgress) => void, config: RunConfig = {}): Promise<RunOutcome> {
  // ① 대상 찾기
  onProgress({ step: '대상 찾기', done: 0, total: 0, problems: 0 });
  const targets = await postPatiently<TargetList>('/api/targets', { startUrl }, config);

  // ② 페이지 수집
  const total = targets.pages.length;
  const results: PageResult[] = [];
  const report = () =>
    onProgress({
      step: '페이지 수집',
      done: results.filter((r) => r.status !== '시간 초과').length,
      total,
      problems: results.filter((r) => r.status === '수집 실패').length,
    });
  report();
  // 첫 요청은 3페이지만 보내 "처음 3페이지 연속 실패"를 4번째 페이지를 열기 전에 판단한다(분석 G-10)
  for (let i = 0; i < total; ) {
    const size = i === 0 ? FIRST_PAGES_TO_CHECK : PAGES_PER_REQUEST;
    if (i > 0) await sleep(GAP_MS);
    results.push(...(await collectChunk(targets.pages.slice(i, i + size), config)));
    i += size;
    report();
    if (isSiteUnavailable(results)) throw new RequestError(SITE_UNAVAILABLE_MESSAGE);
  }
  // "시간 초과" 페이지는 맨 뒤에 1번만 다시 보낸다. 그래도 시간 초과면 "수집 실패"
  const timedOut = results.filter((r) => r.status === '시간 초과');
  for (let i = 0; i < timedOut.length; i += PAGES_PER_REQUEST) {
    await sleep(GAP_MS);
    const retried = await collectChunk(timedOut.slice(i, i + PAGES_PER_REQUEST).map((r) => r.target), config);
    for (const r of retried) {
      const index = results.findIndex((old) => old.target.openUrl === r.target.openUrl);
      results[index] = r.status === '시간 초과' ? { ...r, status: '수집 실패', error: '두 번 모두 시간 초과' } : r;
    }
    report();
  }

  // ③ AI 판단 (파일 내용이 같은 그림은 한 번만, 3개씩) — 결과는 같은 내용의 모든 주소에 나눠 준다
  const plan = planJudging(results);
  const srcs = plan.representatives;
  const judged = new Map<string, Judgement>();
  const reportJudge = () =>
    onProgress({
      step: 'AI 판단',
      done: judged.size,
      total: srcs.length,
      problems: [...judged.values()].filter((j) => j.verdict === '확인 필요').length,
    });
  reportJudge();
  let next = 0;
  const worker = async () => {
    while (next < srcs.length) {
      const src = srcs[next++];
      judged.set(src, await judgeOne(src, config));
      reportJudge();
    }
  };
  await Promise.all(Array.from({ length: JUDGE_CONCURRENCY }, worker));
  const judgements = spreadJudgements(plan, judged);

  // ④ 시트 1 행
  const records = buildRecords(results, judgements, targets.homeMenus);
  return { startUrl, finishedAt: new Date(), targets, results, judgements, records };
}
