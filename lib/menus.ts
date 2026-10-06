// [서버 전용] 메뉴 읽기 → 수집 묶음 목록 (DESIGN.md 5장 ②·7장, PLAN 작업 5)
// 시작 페이지·메인은 열거나 읽지 못하면 최대 2번 다시 시도한다(전체 50초 한도 안에서).
// 시작 페이지에서 초등·중학·고교 메인 주소를 찾고, 메인마다 상단 메뉴를 읽어
// "메인 3개 + 3과정 모두에 있는 상단 메뉴의 하위 메뉴 전부"를 수집 대상으로 만든다(PRD Q1 가).
// 메뉴는 하드코딩하지 않고 매번 사이트에서 읽는다.
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Page } from 'playwright-core';
import { openPage, PAGE_TIMEOUT_MS, withBrowser } from './browser.ts';
import type { Batch, Course, PageTarget } from './types.ts';
import { COURSES } from './types.ts';
import { SITE_UNAVAILABLE_MESSAGE } from './site-check.ts';
import { isAllowedUrl, URL_ERROR_MESSAGE } from './url.ts';

/** 묶음 하나에 넣는 최대 페이지 수 (DESIGN.md 2장 C안) */
export const MAX_PAGES_PER_BATCH = 6;

/** 페이지와 페이지 사이에 쉬는 시간 (PRD must 1: 1초 이상) */
const PAGE_GAP_MS = 1_000;

/** 처음 시도가 실패했을 때 다시 시도하는 횟수 (페이지 수집과 같은 규칙: 최대 2번) */
const MAX_RETRIES = 2;

/**
 * 메뉴 읽기 전체의 시간 한도. /api/menus의 최대 실행 시간(60초) 안에 반드시 응답하기 위함.
 * 재시도는 이 한도 안에서만 한다.
 */
export const MENU_TIME_LIMIT_MS = 50_000;

/** 메뉴 읽기 설정. 시험할 때 시간을 줄이려고 바꿀 수 있게 열어 둔다 */
export interface MenuOptions {
  timeLimitMs?: number;
  pageTimeoutMs?: number;
  gapMs?: number;
  maxRetries?: number;
  /** 다시 시도할 때마다 알려 준다(개발용 실행에서 기록할 때 씀) */
  onRetry?: (url: string, attempt: number) => void;
}

/** 메인 주소 속 과정 이름 → 과정 */
const COURSE_BY_KEY: Record<string, Course> = { ele: '초등', mid: '중학', high: '고교' };

/** 상단 메뉴 하나와 그 하위 메뉴들 */
export interface TopMenu {
  name: string;
  subs: { name: string; url: string }[];
  /**
   * 링크는 있는데 아직 주소·이름이 없는 하위 메뉴 수.
   * 초등 수업하기처럼 처음엔 "1, 2, 3" 자리표시 링크였다가 잠시 뒤 채워지는 메뉴가 있어서,
   * 0보다 크면 "덜 그려짐"으로 보고 더 기다린다.
   */
  pending: number;
}

/** 수집 묶음 목록을 만들 때 생길 수 있는 오류. message는 화면에 그대로 보여 줘도 되는 문장이다 */
export class MenuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MenuError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 메뉴가 다 채워졌는지 확인할 때 다시 읽는 간격과, 다 채워질 때까지 기다리는 최대 시간 */
const STABLE_CHECK_GAP_MS = 500;
const STABLE_MAX_MS = 10_000;

/**
 * 0.5초 간격으로 읽어, "덜 그려짐이 아니고(isEmpty가 false) 직전과 같은 결과"가 나오면 확정한다(최대 10초).
 * 메뉴 이름·주소 일부는 페이지가 열린 뒤 채워지므로, 덜 채워진 메뉴를 읽지 않기 위함.
 * 시간이 다 되면 마지막으로 읽은 내용을 돌려준다.
 */
async function readWhenStable<T>(
  page: Page,
  read: (page: Page) => Promise<T>,
  isEmpty: (value: T) => boolean,
  maxMs: number,
): Promise<T> {
  const until = Date.now() + Math.min(STABLE_MAX_MS, maxMs);
  let previous = await read(page);
  while (Date.now() < until) {
    await sleep(STABLE_CHECK_GAP_MS);
    const current = await read(page);
    if (!isEmpty(current) && JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
  return previous;
}

/**
 * 페이지를 열고(browser.ts의 openPage) 메뉴가 다 채워질 때까지 기다려 내용을 읽는다.
 * 실패하면 1초 쉬고 최대 2번 다시 시도한다.
 * - 페이지가 안 열리거나, 읽은 내용이 비어 있으면(화면이 덜 그려짐) 다시 시도한다
 * - 기다리는 시간은 60초와 남은 메뉴 읽기 시간 중 짧은 쪽
 * - 끝까지 비어 있으면 마지막으로 읽은 내용을 그대로 돌려준다(부르는 쪽이 알맞은 안내를 고른다)
 * - 한 번도 열지 못했으면 "사이트 접속 불가"
 */
async function openAndRead<T>(
  page: Page,
  url: string,
  read: (page: Page) => Promise<T>,
  isEmpty: (value: T) => boolean,
  timing: { timeLeft: () => number; pageTimeoutMs: number; gapMs: number; maxRetries: number },
  onRetry?: (url: string, attempt: number) => void,
): Promise<T> {
  let lastRead: { value: T } | null = null;
  for (let attempt = 0; attempt <= timing.maxRetries; attempt++) {
    if (attempt > 0) {
      onRetry?.(url, attempt);
      await sleep(timing.gapMs);
    }
    const waitMs = Math.min(timing.pageTimeoutMs, timing.timeLeft());
    if (waitMs <= 0) break;
    try {
      const started = Date.now();
      await openPage(page, url, waitMs);
      lastRead = { value: await readWhenStable(page, read, isEmpty, waitMs - (Date.now() - started)) };
      if (!isEmpty(lastRead.value)) return lastRead.value;
    } catch {
      // 열리지 않음 → 다음 시도로 넘어간다
    }
  }
  if (lastRead) return lastRead.value;
  throw new MenuError(SITE_UNAVAILABLE_MESSAGE);
}

/** 시작 페이지에서 과정별 메인 주소를 찾는다 */
async function readCourseMains(page: Page): Promise<Partial<Record<Course, string>>> {
  // 링크는 javascript:logWriteAndMove('/view/edu/ele/main', ...) 형태라 그 안의 주소를 꺼낸다
  const paths = await page.$$eval('a', (links) =>
    links.map((a) => `${a.getAttribute('href') ?? ''} ${a.getAttribute('onclick') ?? ''}`),
  );
  const mains: Partial<Record<Course, string>> = {};
  for (const text of paths) {
    const m = text.match(/'(\/view\/edu\/(ele|mid|high)\/main)'/);
    if (m && !mains[COURSE_BY_KEY[m[2]]]) mains[COURSE_BY_KEY[m[2]]] = new URL(m[1], page.url()).href;
  }
  return mains;
}

/** 메인 페이지의 상단 메뉴(header nav)를 읽는다 */
async function readTopMenus(page: Page): Promise<TopMenu[]> {
  const raw = await page.$$eval('header nav > ul > li', (items) =>
    items.map((li) => {
      const link = (a: Element | null) => `${a?.getAttribute('href') ?? ''} ${a?.getAttribute('onclick') ?? ''}`;
      const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const top = li.querySelector(':scope > a');
      return {
        name: clean(top?.textContent),
        topLink: link(top),
        subs: [...li.querySelectorAll(':scope > ul > li > a')].map((a) => ({ name: clean(a.textContent), link: link(a) })),
      };
    }),
  );
  // 링크 글자에서 '/view/...' 주소를 꺼내 전체 주소로 바꾼다
  const toUrl = (link: string) => {
    const m = link.match(/'(\/view\/[^']+)'/) ?? link.match(/(\/view\/\S+)/);
    return m ? new URL(m[1], page.url()).href : null;
  };
  return raw
    .filter((menu) => menu.name)
    .map((menu) => {
      const subs = menu.subs
        .map((s) => ({ name: s.name, url: toUrl(s.link) }))
        .filter((s): s is { name: string; url: string } => Boolean(s.name && s.url));
      const pending = menu.subs.length - subs.length;
      // 하위 메뉴 링크가 아예 없으면 상단 메뉴 링크 자체를 수집 대상으로 쓴다
      // (하위 메뉴가 아직 채워지는 중이면 상단 링크로 대신하지 않는다 — pending으로 다시 읽게 함)
      const topUrl = toUrl(menu.topLink);
      const fallback = menu.subs.length === 0 && topUrl ? [{ name: menu.name, url: topUrl }] : [];
      return { name: menu.name, subs: subs.length > 0 ? subs : fallback, pending };
    });
}

/**
 * 과정별 메인 주소와 상단 메뉴로 수집 묶음 목록을 만든다(브라우저 없이 계산만 하는 부분).
 * - 묶음 순서: 과정(초등→중학→고교) → 메인 → 상단 메뉴 순서
 * - 묶음 하나는 같은 과정·같은 상단 메뉴의 페이지로, 최대 6페이지
 */
export function buildBatches(
  mains: Record<Course, string>,
  menusByCourse: Record<Course, TopMenu[]>,
): Batch[] {
  // 3과정 모두에 있는 상단 메뉴 이름 (첫 과정의 메뉴 순서를 따른다)
  const common = menusByCourse[COURSES[0]]
    .map((m) => m.name)
    .filter((name) => COURSES.every((c) => menusByCourse[c].some((m) => m.name === name)));

  const batches: Batch[] = [];
  for (const course of COURSES) {
    batches.push({
      id: `${course}-메인`,
      course,
      label: `${course} > 메인`,
      pages: [{ course, menu: '메인', url: mains[course] }],
    });
    const seen = new Set<string>([mains[course]]);
    for (const name of common) {
      const menu = menusByCourse[course].find((m) => m.name === name)!;
      const pages: PageTarget[] = [];
      for (const sub of menu.subs) {
        if (seen.has(sub.url)) continue; // 같은 주소를 두 번 수집하지 않는다
        seen.add(sub.url);
        pages.push({ course, menu: sub.name === name ? name : `${name} > ${sub.name}`, url: sub.url });
      }
      for (let i = 0; i < pages.length; i += MAX_PAGES_PER_BATCH) {
        const part = Math.floor(i / MAX_PAGES_PER_BATCH) + 1;
        batches.push({
          id: `${course}-${name}-${part}`,
          course,
          label: `${course} > ${name}`,
          pages: pages.slice(i, i + MAX_PAGES_PER_BATCH),
        });
      }
    }
  }
  return batches;
}

/**
 * 시작 주소에서 출발해 수집 묶음 목록을 만든다.
 * - 시작 페이지와 메인 3개는 각각 최대 2번 다시 시도한다(전체 50초 한도 안에서)
 * - 시작 주소가 잘못됐거나, 다시 시도해도 열지 못하면 MenuError를 던진다
 */
export async function loadBatches(
  startUrl: string,
  options: MenuOptions = {},
): Promise<{ batches: Batch[]; totalPages: number }> {
  if (!isAllowedUrl(startUrl)) throw new MenuError(URL_ERROR_MESSAGE);
  const {
    timeLimitMs = MENU_TIME_LIMIT_MS,
    pageTimeoutMs = PAGE_TIMEOUT_MS,
    gapMs = PAGE_GAP_MS,
    maxRetries = MAX_RETRIES,
    onRetry,
  } = options;
  const deadline = Date.now() + timeLimitMs;
  const timing = { timeLeft: () => deadline - Date.now(), pageTimeoutMs, gapMs, maxRetries };

  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    try {
      // 시작 페이지: 세 과정 중 하나라도 못 찾으면 덜 그려진 것으로 보고 다시 읽는다
      const found = await openAndRead(
        page,
        startUrl.trim(),
        readCourseMains,
        (mains) => COURSES.some((c) => !mains[c]),
        timing,
        onRetry,
      );
      const missing = COURSES.filter((c) => !found[c]);
      if (missing.length > 0) throw new MenuError(`시작 페이지에서 ${missing.join('·')} 과정을 찾지 못했어요`);
      const mains = found as Record<Course, string>;

      const menusByCourse = {} as Record<Course, TopMenu[]>;
      for (const course of COURSES) {
        await sleep(gapMs);
        // 메인: 상단 메뉴가 하나도 없으면 덜 그려진 것으로 보고 다시 읽는다
        menusByCourse[course] = await openAndRead(
          page,
          mains[course],
          readTopMenus,
          (menus) => menus.length === 0 || menus.some((m) => m.pending > 0),
          timing,
          onRetry,
        );
        if (menusByCourse[course].length === 0) throw new MenuError(`${course} 메인에서 상단 메뉴를 읽지 못했어요`);
        // 다시 시도해도 덜 채워진 메뉴가 있으면, 수집 대상을 빠뜨린 채 진행하지 않고 멈춘다
        if (menusByCourse[course].some((m) => m.pending > 0)) {
          throw new MenuError(`${course} 메인의 메뉴가 다 표시되지 않았어요 — 잠시 후 다시 시도하세요`);
        }
      }

      const batches = buildBatches(mains, menusByCourse);
      const totalPages = batches.reduce((sum, b) => sum + b.pages.length, 0);
      return { batches, totalPages };
    } catch (error) {
      if (error instanceof MenuError) throw error;
      throw new MenuError(SITE_UNAVAILABLE_MESSAGE); // 페이지가 열리지 않음 등
    }
  });
}
