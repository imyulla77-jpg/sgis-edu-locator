// [서버 전용] 브라우저 띄우기 (DESIGN.md 7장 "브라우저 띄우기", PLAN 작업 4)
// 담당자 PC에 설치된 Edge를 쓰고, 없으면 Chrome을 쓴다.
// Vercel에는 Edge·Chrome이 없어서 서버용 크롬(@sparticuz/chromium)을 쓴다(Part 5, launchBrowser).
//
// scripts/collect-dev.ts에서도 불러올 수 있도록 다른 lib 파일을 불러오지 않는다(CLAUDE.md 5장).

import { chromium, type Browser, type Page, type Response } from 'playwright-core';

/** 페이지 하나가 열릴 때까지 기다리는 최대 시간 (PRD must 1: 60초) */
export const PAGE_TIMEOUT_MS = 60_000;

/**
 * 화면 구조가 준비된 뒤, 화면을 마저 그리는 추가 요청이 멈출 때까지 더 기다리는 최대 시간.
 * SGIS에듀 초등 메인처럼 숨은 로그인 창(iframe) 때문에 요청이 끝까지 멈추지 않는 페이지가 있어서,
 * "요청이 모두 멈출 때까지" 무작정 기다리지 않고 이 시간까지만 기다린다.
 */
export const SETTLE_MAX_MS = 5_000;

/** PC에 쓸 수 있는 브라우저가 없을 때 보여 줄 안내 (DESIGN.md 9장) */
export const NO_BROWSER_MESSAGE = 'PC에 Edge나 Chrome이 필요해요';

/** 시도할 브라우저 순서: Edge → Chrome */
const CHANNELS = ['msedge', 'chrome'] as const;

/** 브라우저를 찾지 못했을 때 쓰는 오류 */
export class BrowserNotFoundError extends Error {
  constructor() {
    super(NO_BROWSER_MESSAGE);
    this.name = 'BrowserNotFoundError';
  }
}

/** Vercel 같은 서버리스 서버에서 실행 중인지 (Edge·Chrome이 설치돼 있지 않은 곳) */
function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * 화면 없이(headless) 브라우저를 띄운다.
 * - 담당자 PC: Edge가 없으면 Chrome, 둘 다 없으면 BrowserNotFoundError
 * - Vercel 서버: 서버용 크롬(@sparticuz/chromium)을 풀어서 띄운다. 이 패키지는 Vercel에서만 불러온다
 */
export async function launchBrowser(): Promise<Browser> {
  if (isServerless()) {
    const { default: serverChrome } = await import('@sparticuz/chromium');
    return chromium.launch({ executablePath: await serverChrome.executablePath(), args: serverChrome.args, headless: true });
  }
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // 이 브라우저가 설치돼 있지 않으면 다음 브라우저를 시도한다
    }
  }
  throw new BrowserNotFoundError();
}

/** 브라우저를 띄워 일을 맡기고, 성공하든 실패하든 끝나면 반드시 닫는다 */
export async function withBrowser<T>(work: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await launchBrowser();
  try {
    return await work(browser);
  } finally {
    await browser.close();
  }
}

/**
 * 페이지를 연다. 메뉴 읽기와 페이지 수집이 함께 쓴다.
 * 1. 화면 구조(DOM)가 준비될 때까지 기다린다 — 최대 timeoutMs. 넘으면 TimeoutError
 * 2. 화면을 마저 그리는 추가 요청이 멈출 때까지 더 기다린다 — 최대 5초(timeoutMs 안에서). 넘어도 오류 없이 진행
 */
export async function openPage(page: Page, url: string, timeoutMs: number): Promise<Response | null> {
  const started = Date.now();
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const settleMs = Math.min(SETTLE_MAX_MS, timeoutMs - (Date.now() - started));
  if (settleMs > 0) await page.waitForLoadState('networkidle', { timeout: settleMs }).catch(() => {});
  return response;
}

/** 페이지 하나를 열어 제목을 읽고 닫는다. 브라우저 띄우기가 잘 되는지 확인할 때 쓴다 */
export async function readPageTitle(url: string): Promise<string> {
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    return page.title();
  });
}
