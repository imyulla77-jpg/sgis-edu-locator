// [서버 전용] 메뉴 읽기 → 수집 묶음 목록 (DESIGN.md 5장 ②·7장, PLAN 작업 5)
// 시작 페이지에서 초등·중학·고교 메인 주소를 찾고, 메인마다 상단 메뉴를 읽어
// "메인 3개 + 3과정 모두에 있는 상단 메뉴의 하위 메뉴 전부"를 수집 대상으로 만든다(PRD Q1 가).
// 메뉴는 하드코딩하지 않고 매번 사이트에서 읽는다.
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Page } from 'playwright-core';
import { PAGE_TIMEOUT_MS, withBrowser } from './browser.ts';
import type { Batch, Course, PageTarget } from './types.ts';
import { COURSES } from './types.ts';
import { SITE_UNAVAILABLE_MESSAGE } from './site-check.ts';
import { isAllowedUrl, URL_ERROR_MESSAGE } from './url.ts';

/** 묶음 하나에 넣는 최대 페이지 수 (DESIGN.md 2장 C안) */
export const MAX_PAGES_PER_BATCH = 6;

/** 페이지와 페이지 사이에 쉬는 시간 (PRD must 1: 1초 이상) */
const PAGE_GAP_MS = 1_000;

/** 메인 주소 속 과정 이름 → 과정 */
const COURSE_BY_KEY: Record<string, Course> = { ele: '초등', mid: '중학', high: '고교' };

/** 상단 메뉴 하나와 그 하위 메뉴들 */
export interface TopMenu {
  name: string;
  subs: { name: string; url: string }[];
}

/** 수집 묶음 목록을 만들 때 생길 수 있는 오류. message는 화면에 그대로 보여 줘도 되는 문장이다 */
export class MenuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MenuError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 페이지를 열고, 화면이 다 그려질 때까지(추가 요청이 멈출 때까지) 기다린다 */
async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
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
      // 하위 메뉴가 없으면 상단 메뉴 링크 자체를 수집 대상으로 쓴다
      const topUrl = toUrl(menu.topLink);
      return { name: menu.name, subs: subs.length > 0 ? subs : topUrl ? [{ name: menu.name, url: topUrl }] : [] };
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
 * 시작 주소가 잘못됐거나, 시작 페이지·메인 3개 중 하나라도 열지 못하면 MenuError를 던진다.
 */
export async function loadBatches(startUrl: string): Promise<{ batches: Batch[]; totalPages: number }> {
  if (!isAllowedUrl(startUrl)) throw new MenuError(URL_ERROR_MESSAGE);

  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    try {
      await openPage(page, startUrl.trim());
      const found = await readCourseMains(page);
      const missing = COURSES.filter((c) => !found[c]);
      if (missing.length > 0) throw new MenuError(`시작 페이지에서 ${missing.join('·')} 과정을 찾지 못했어요`);
      const mains = found as Record<Course, string>;

      const menusByCourse = {} as Record<Course, TopMenu[]>;
      for (const course of COURSES) {
        await sleep(PAGE_GAP_MS);
        await openPage(page, mains[course]);
        menusByCourse[course] = await readTopMenus(page);
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
