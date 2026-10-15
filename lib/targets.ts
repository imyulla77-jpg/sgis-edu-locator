// [서버 전용] 검색 대상 페이지 목록 만들기 (DESIGN.md 2.1·2.3장, PLAN 작업 6)
// 1. 시작 페이지에서 초등·중학·고교 메인 주소를 찾는다
// 2. 메인마다 상단 메뉴를 읽어, PRD 4장 표에 있는 3단계 메뉴만 고른다(띄어쓰기 무시 비교)
// 3. 수업하기·주제보기는 화면이 스스로 불러오는 목록 데이터(JSON)로 상세 페이지(콘텐츠)를 모으고,
//    스스로하기는 메뉴 화면 자체를 대상으로 한다. 같은 콘텐츠는 한 번만 열고 나오는 위치를 모두 붙인다
// 4. SGIS 홈페이지 상단 메뉴에서 4개 메뉴(통계주제도·대화형 통계지도·활용서비스·분석지도)의 하위 메뉴를 읽는다
// 메뉴 이름·번호·주소는 코드에 적어 두지 않고 매번 사이트에서 읽는다. 코드에 있는 것은 요구사항 표(이름)뿐이다.
// 사이트 요청은 1초 이상 간격으로 하나씩 보낸다.
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Page } from 'playwright-core';
import { openPage, PAGE_TIMEOUT_MS, withBrowser } from './browser.ts';
import type { Course, HomeMenu, HomeMenuItem, Level2, MenuLocation, PageTarget, TargetList } from './refresh-types.ts';
import { COURSES } from './refresh-types.ts';
import { SITE_UNAVAILABLE_MESSAGE } from './site-check.ts';
import { isAllowedUrl, isCollectablePage, URL_ERROR_MESSAGE } from './url.ts';

/** PRD 4장 검색 대상 메뉴 표 (요구사항 문서 2페이지). 2단계 → 3단계 이름 */
export const SEARCH_TABLE: Record<Course, Partial<Record<Level2, string[]>>> = {
  초등: {
    수업하기: ['인문환경과 인간생활', '지속가능한 세계', '자연환경과 인간생활'],
    스스로하기: ['우리나라의 인구변화', '우리나라의 기후변화'],
    주제보기: ['인구와 고령화', '가정과 다문화', '지역과 도시화', '경제와 산업', '환경과 안전', '지리정보와 지도'],
  },
  중학: {
    수업하기: ['지리인식', '인문환경과 인간생활', '지속 가능한 세계', '자연환경과 인간생활'],
    주제보기: ['인구와 고령화', '가정과 다문화', '지역과 도시화', '경제와 산업', '환경과 안전', '지리정보와 지도'],
  },
  고교: {
    수업하기: ['인구 변화와 다문화 공간', '생산과 소비의 공간', '우리나라의 지역 이해', '기후환경과 인간생활', '거주 공간의 변화와 지역 개발'],
    주제보기: ['인구와 고령화', '가정과 다문화', '지역과 도시화', '경제와 산업', '환경과 안전', '지리정보와 지도'],
  },
};

/** 홈페이지 경로를 찾는 메뉴 4개 */
const HOME_MENUS: HomeMenu[] = ['통계주제도', '대화형 통계지도', '활용서비스', '분석지도'];

/** SGIS 홈페이지 메인 */
const HOME_URL = 'https://sgis.mods.go.kr/';

/** 사이트 요청 사이에 쉬는 시간 (PRD must 1: 1초 이상) */
const REQUEST_GAP_MS = 1_000;

/** 페이지·목록 데이터를 다시 시도하는 횟수 (페이지 수집과 같은 규칙: 최대 2번) */
const MAX_RETRIES = 2;

/** 목록 데이터를 몇 쪽까지 넘겨 보는지 (끝없이 넘기지 않게) */
const MAX_LIST_PAGES = 20;

/** 대상 찾기 전체의 시간 한도. /api/targets 최대 실행 시간(120초) 안에 반드시 응답하기 위함 */
export const TARGETS_TIME_LIMIT_MS = 100_000;

/** 메인 주소 속 과정 이름 ↔ 과정 */
const COURSE_BY_KEY: Record<string, Course> = { ele: '초등', mid: '중학', high: '고교' };
const KEY_BY_COURSE: Record<Course, string> = { 초등: 'ele', 중학: 'mid', 고교: 'high' };

/** 콘텐츠 번호 첫 글자 → 그 콘텐츠의 과정 (예: H0101 → 고교) */
const COURSE_BY_PREFIX: Record<string, Course> = { E: '초등', M: '중학', H: '고교' };

/** 대상 찾기 중 생긴 오류. message는 화면에 그대로 보여 줘도 되는 문장이다 */
export class TargetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetsError';
  }
}

export interface TargetsOptions {
  timeLimitMs?: number;
  gapMs?: number;
  /** 다시 시도할 때마다 알려 준다(개발용 실행에서 기록할 때 씀) */
  onRetry?: (what: string, attempt: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 띄어쓰기를 모두 지운 이름 (표와 사이트의 띄어쓰기 차이를 무시하고 비교) */
export function nameKey(name: string): string {
  return name.replace(/\s+/g, '');
}

/**
 * 표의 이름과 같은 사이트 메뉴를 찾는다. 띄어쓰기를 무시하고 먼저 똑같은 이름을 찾고,
 * 없으면 조사 "의"까지 무시하고 찾는다(표 "우리나라의 인구변화" ↔ 사이트 "우리나라 인구변화").
 */
export function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const loose = (s: string) => nameKey(s).replace(/의/g, '');
  return items.find((i) => nameKey(i.name) === nameKey(name)) ?? items.find((i) => loose(i.name) === loose(name));
}

/** 링크의 href·onclick 글자에서 사이트 안 주소('/view/…')를 꺼낸다 */
function pathInLink(link: string): string | null {
  const m = link.match(/'(\/[A-Za-z][^']*)'/) ?? link.match(/(\/view\/[^\s'")]+)/);
  return m ? m[1] : null;
}

// ─── 브라우저로 읽는 부분 ───────────────────────────────────────────

/** 시작 페이지에서 과정별 메인 주소를 찾는다 */
async function readCourseMains(page: Page): Promise<Partial<Record<Course, string>>> {
  const links = await page.$$eval('a', (as) => as.map((a) => `${a.getAttribute('href') ?? ''} ${a.getAttribute('onclick') ?? ''}`));
  const mains: Partial<Record<Course, string>> = {};
  for (const text of links) {
    const m = text.match(/'(\/view\/edu\/(ele|mid|high)\/main)'/);
    if (m && !mains[COURSE_BY_KEY[m[2]]]) mains[COURSE_BY_KEY[m[2]]] = new URL(m[1], page.url()).href;
  }
  return mains;
}

/** 에듀 메인 상단 메뉴: 2단계 이름과 3단계(이름·링크 글자) */
export interface RawEduMenu {
  name: string;
  subs: { name: string; link: string }[];
}

async function readEduMenus(page: Page): Promise<RawEduMenu[]> {
  return page.$$eval('header nav > ul > li', (items) =>
    items.map((li) => {
      const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      return {
        name: clean(li.querySelector(':scope > a')?.textContent),
        subs: [...li.querySelectorAll(':scope > ul > li > a')].map((a) => ({
          name: clean(a.textContent),
          link: `${a.getAttribute('href') ?? ''} ${a.getAttribute('onclick') ?? ''}`,
        })),
      };
    }),
  );
}

/** 홈페이지 상단 메뉴: 1단계 이름들과, 같은 순서로 놓인 하위 메뉴 목록(사이트맵) */
export interface RawHomeMenus {
  tops: string[];
  subLists: { name: string; link: string }[][];
}

async function readHomeMenus(page: Page): Promise<RawHomeMenus> {
  return page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const link = (a: Element) => `${a.getAttribute('href') ?? ''} ${a.getAttribute('onclick') ?? ''}`;
    // "N 통계주제도"처럼 앞에 붙은 새 소식 표시(N)는 뗀다
    const tops = [...document.querySelectorAll('#gnb > ul > li > a')].map((a) => clean(a.textContent).replace(/^N\s+/, ''));
    const subLists = [...document.querySelectorAll('.headerDiv .subMenu .inner > div > ul')].map((ul) =>
      [...ul.querySelectorAll('a')].map((a) => ({ name: clean(a.textContent), link: link(a) })),
    );
    return { tops, subLists };
  });
}

// ─── 읽은 내용을 계산하는 부분 (브라우저 없이) ─────────────────────────

/** 표의 3단계 메뉴 하나와, 사이트에서 찾은 그 메뉴의 주소 */
export interface Level3Menu {
  course: Course;
  level2: Level2;
  /** 표에 적힌 이름 */
  level3: string;
  /** 사이트 메뉴 주소 (예: …/classList?thema_id=E01) */
  url: string;
}

/**
 * 과정별 상단 메뉴에서 표의 3단계 메뉴를 찾는다.
 * 표에 있는데 사이트에 없는 메뉴는 warnings에 적는다.
 */
export function pickLevel3Menus(
  menusByCourse: Record<Course, RawEduMenu[]>,
  baseUrl: string,
): { menus: Level3Menu[]; warnings: string[] } {
  const menus: Level3Menu[] = [];
  const warnings: string[] = [];
  for (const course of COURSES) {
    for (const [level2, names] of Object.entries(SEARCH_TABLE[course]) as [Level2, string[]][]) {
      const top = findByName(menusByCourse[course], level2);
      for (const level3 of names) {
        const sub = top ? findByName(top.subs, level3) : undefined;
        const path = sub ? pathInLink(sub.link) : null;
        const url = path ? new URL(path, baseUrl).href : null;
        if (!url || !isCollectablePage(url)) {
          warnings.push(`사이트 메뉴에서 "${course} > ${level2} > ${level3}"를 찾지 못했어요`);
          continue;
        }
        menus.push({ course, level2, level3, url });
      }
    }
  }
  return { menus, warnings };
}

/** 홈페이지 상단 메뉴 중 4개 메뉴의 하위 메뉴를 꺼낸다 */
export function parseHomeMenus(raw: RawHomeMenus, baseUrl: string): { items: HomeMenuItem[]; warnings: string[] } {
  const items: HomeMenuItem[] = [];
  const warnings: string[] = [];
  if (raw.tops.length !== raw.subLists.length) {
    warnings.push('SGIS 홈페이지 메뉴 모양이 바뀌어 하위 메뉴를 읽지 못했어요. 홈페이지 경로는 바로가기 버튼 문구로만 정해요');
    return { items, warnings };
  }
  for (const menu of HOME_MENUS) {
    const index = raw.tops.findIndex((t) => nameKey(t) === nameKey(menu));
    if (index < 0) {
      warnings.push(`SGIS 홈페이지에서 "${menu}" 메뉴를 찾지 못했어요`);
      continue;
    }
    for (const sub of raw.subLists[index]) {
      const path = pathInLink(sub.link);
      if (sub.name && path) items.push({ menu, name: sub.name, url: new URL(path, baseUrl).href });
    }
  }
  return { items, warnings };
}

/** 목록 데이터의 콘텐츠 하나 */
export interface ListedContent {
  contentsId: string;
  title: string;
}

/**
 * 3단계 메뉴와 각 메뉴의 콘텐츠 목록으로 검색 대상 페이지를 만든다.
 * - 같은 콘텐츠는 한 페이지로 합치고 위치를 모두 붙인다
 * - 여는 주소는 콘텐츠 번호 첫 글자의 과정(E·M·H)의 수업 상세 화면
 * - 스스로하기처럼 목록이 없는 메뉴(contents가 null)는 메뉴 화면 자체가 대상
 */
export function buildTargets(lists: { menu: Level3Menu; contents: ListedContent[] | null }[], baseUrl: string): PageTarget[] {
  const byKey = new Map<string, PageTarget>();
  for (const { menu, contents } of lists) {
    if (contents === null) {
      const location: MenuLocation = { course: menu.course, level2: menu.level2, level3: menu.level3, url: menu.url };
      const existing = byKey.get(menu.url);
      if (existing) existing.locations.push(location);
      else byKey.set(menu.url, { contentsId: null, openUrl: menu.url, locations: [location] });
      continue;
    }
    const detail = menu.level2 === '주제보기' ? 'issueDetail' : 'classDetail';
    for (const item of contents) {
      const location: MenuLocation = {
        course: menu.course,
        level2: menu.level2,
        level3: menu.level3,
        url: new URL(`/view/edu/${KEY_BY_COURSE[menu.course]}/${detail}?contents_id=${encodeURIComponent(item.contentsId)}`, baseUrl).href,
      };
      const existing = byKey.get(item.contentsId);
      if (existing) {
        if (!existing.locations.some((l) => l.url === location.url)) existing.locations.push(location);
        continue;
      }
      const ownCourse = COURSE_BY_PREFIX[item.contentsId[0]] ?? menu.course;
      byKey.set(item.contentsId, {
        contentsId: item.contentsId,
        openUrl: new URL(`/view/edu/${KEY_BY_COURSE[ownCourse]}/classDetail?contents_id=${encodeURIComponent(item.contentsId)}`, baseUrl).href,
        title: item.title || undefined,
        locations: [location],
      });
    }
  }
  return [...byKey.values()];
}

// ─── 사이트 요청 ───────────────────────────────────────────────

/** 3단계 메뉴 주소에서 목록 데이터 요청 방법을 정한다. 스스로하기 등 목록이 없는 메뉴는 null */
function listRequestFor(menuUrl: string): { api: string; field: string; id: string } | null {
  const url = new URL(menuUrl);
  if (/\/classList$/.test(url.pathname) && url.searchParams.get('thema_id')) {
    return { api: '/ServiceAPI/edu/eduContentsList.json', field: 'thema_id', id: url.searchParams.get('thema_id')! };
  }
  if (/\/issueList$/.test(url.pathname) && url.searchParams.get('issue_id')) {
    return { api: '/ServiceAPI/edu/eduIssueContentsList.json', field: 'issue_id', id: url.searchParams.get('issue_id')! };
  }
  return null;
}

/** 목록 데이터 한 쪽의 모양 (필요한 칸만) */
interface ListResponse {
  result?: { totalCount?: number; resultList?: { contents_id?: string; contents_title?: string }[] };
}

export async function loadTargets(startUrl: string, options: TargetsOptions = {}): Promise<TargetList> {
  if (!isAllowedUrl(startUrl)) throw new TargetsError(URL_ERROR_MESSAGE);
  const { timeLimitMs = TARGETS_TIME_LIMIT_MS, gapMs = REQUEST_GAP_MS, onRetry } = options;
  const deadline = Date.now() + timeLimitMs;
  const timeLeft = () => deadline - Date.now();

  /** 실패하면 쉬었다가 최대 2번 다시 시도한다. 시간이 다 되면 "사이트 접속 불가" */
  async function retry<T>(what: string, work: (waitMs: number) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        onRetry?.(what, attempt);
        await sleep(gapMs);
      }
      const waitMs = Math.min(PAGE_TIMEOUT_MS, timeLeft());
      if (waitMs <= 0) break;
      try {
        return await work(waitMs);
      } catch (error) {
        if (error instanceof TargetsError) throw error;
      }
    }
    throw new TargetsError(SITE_UNAVAILABLE_MESSAGE);
  }

  return withBrowser(async (browser) => {
    const page = await browser.newPage();

    /** 페이지를 열고, 다 그려질 때까지(isReady) 0.5초 간격으로 최대 10초 다시 읽는다 */
    async function openAndRead<T>(url: string, read: (p: Page) => Promise<T>, isReady: (v: T) => boolean): Promise<T> {
      return retry(url, async (waitMs) => {
        await openPage(page, url, waitMs);
        // 사이트가 다른 주소로 넘겨줬으면 그 화면을 읽지 않는다(CHECK.md SEC-001)
        if (!isAllowedUrl(page.url())) throw new TargetsError('사이트가 sgis.mods.go.kr 밖의 주소로 넘어가서 메뉴를 읽지 않았어요');
        const until = Date.now() + Math.min(10_000, timeLeft());
        let value = await read(page);
        while (!isReady(value) && Date.now() < until) {
          await sleep(500);
          value = await read(page);
        }
        if (!isReady(value)) throw new Error('덜 그려짐');
        return value;
      });
    }

    /** 목록 데이터 한 쪽을 받는다 (브라우저와 같은 쿠키로 보냄) */
    async function fetchListPage(req: { api: string; field: string; id: string }, pageIndex: number): Promise<ListResponse> {
      return retry(`${req.api} ${req.id} ${pageIndex}쪽`, async (waitMs) => {
        const res = await page.request.post(new URL(req.api, HOME_URL).href, {
          form: { [req.field]: req.id, currentPageIndex: String(pageIndex) },
          timeout: waitMs,
        });
        if (!res.ok()) throw new Error(`목록 데이터 ${res.status()}`);
        return (await res.json()) as ListResponse;
      });
    }

    // 1. 시작 페이지 → 과정별 메인 주소
    const found = await openAndRead(startUrl.trim(), readCourseMains, (m) => COURSES.every((c) => m[c]));
    const mains = found as Record<Course, string>;

    // 2. 메인마다 상단 메뉴 (3단계가 하나라도 있으면 다 그려진 것으로 본다)
    const menusByCourse = {} as Record<Course, RawEduMenu[]>;
    for (const course of COURSES) {
      await sleep(gapMs);
      menusByCourse[course] = await openAndRead(mains[course], readEduMenus, (menus) =>
        menus.some((m) => m.subs.some((s) => s.name && pathInLink(s.link))),
      );
    }
    const { menus, warnings } = pickLevel3Menus(menusByCourse, HOME_URL);
    if (menus.length === 0) throw new TargetsError('사이트 메뉴에서 검색 대상 메뉴를 하나도 찾지 못했어요');

    // 3. 목록 데이터. 주제보기 목록은 과정과 상관없이 같으므로 같은 요청은 한 번만 보낸다
    const cache = new Map<string, ListedContent[]>();
    const lists: { menu: Level3Menu; contents: ListedContent[] | null }[] = [];
    for (const menu of menus) {
      const req = listRequestFor(menu.url);
      if (!req) {
        lists.push({ menu, contents: null });
        continue;
      }
      const cacheKey = `${req.api}|${req.id}`;
      let contents = cache.get(cacheKey);
      if (!contents) {
        contents = [];
        for (let pageIndex = 1; pageIndex <= MAX_LIST_PAGES; pageIndex++) {
          await sleep(gapMs);
          const data = await fetchListPage(req, pageIndex);
          const rows = data.result?.resultList ?? [];
          for (const row of rows) {
            if (row.contents_id) contents.push({ contentsId: row.contents_id.trim(), title: (row.contents_title ?? '').trim() });
          }
          if (rows.length === 0 || contents.length >= (data.result?.totalCount ?? 0)) break;
        }
        cache.set(cacheKey, contents);
      }
      if (contents.length === 0) warnings.push(`"${menu.course} > ${menu.level2} > ${menu.level3}" 목록에 콘텐츠가 없어요`);
      lists.push({ menu, contents });
    }
    const pages = buildTargets(lists, HOME_URL);

    // 4. SGIS 홈페이지 4개 메뉴의 하위 메뉴
    await sleep(gapMs);
    const rawHome = await openAndRead(HOME_URL, readHomeMenus, (r) => r.tops.length > 0 && r.subLists.length > 0);
    const home = parseHomeMenus(rawHome, HOME_URL);

    return { pages, homeMenus: home.items, warnings: [...warnings, ...home.warnings] };
  });
}
