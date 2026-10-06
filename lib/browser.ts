// [서버 전용] 브라우저 띄우기 (DESIGN.md 7장 "브라우저 띄우기", PLAN 작업 4)
// 담당자 PC에 설치된 Edge를 쓰고, 없으면 Chrome을 쓴다.
// Vercel용 @sparticuz/chromium 연결은 Part 5에서 이 파일에 추가한다.
//
// scripts/collect-dev.ts에서도 불러올 수 있도록 다른 lib 파일을 불러오지 않는다(CLAUDE.md 5장).

import { chromium, type Browser } from 'playwright-core';

/** 페이지 하나가 열릴 때까지 기다리는 최대 시간 (PRD must 1: 60초) */
export const PAGE_TIMEOUT_MS = 60_000;

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

/** 화면 없이(headless) 브라우저를 띄운다. Edge가 없으면 Chrome, 둘 다 없으면 BrowserNotFoundError */
export async function launchBrowser(): Promise<Browser> {
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

/** 페이지 하나를 열어 제목을 읽고 닫는다. 브라우저 띄우기가 잘 되는지 확인할 때 쓴다 */
export async function readPageTitle(url: string): Promise<string> {
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    return page.title();
  });
}
