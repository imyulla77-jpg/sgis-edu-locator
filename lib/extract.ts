// [서버 전용] 열린 페이지에서 이미지·문구 읽기 (DESIGN.md 6장, PLAN 작업 8)
// - 탭·펼침 메뉴를 클릭하지 않고 화면 구조(DOM) 전체를 읽는다 → 숨은 요소도 함께 수집
// - 이미지: <img> 태그와 CSS 배경 이미지 / 문구: 글자 + 버튼 글자
// - 항목마다 영역(상단/본문/하단)과 숨김 여부를 붙인다. 메뉴·페이지 주소는 수집 대상(PageTarget)에 이미 있다
// - 게시판 데이터(글 제목·글쓴이 등)는 수집하지 않는다(PRD Q4, PLAN 작업 9)
// - 그림 파일 지문(작업 10)은 다음 작업에서 붙인다
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Page } from 'playwright-core';
import type { PageTarget, RawItem } from './types.ts';

/**
 * 게시판 데이터가 들어 있는 영역 (DESIGN.md 6장 "게시판 데이터 제외 규칙")
 * - 모든 페이지: 이름이 board…List인 게시글 목록 (게시판 페이지의 `#boardList`, 메인 미리보기의 `#board12List`·`#board13List` 등)
 * - 게시판 페이지(주소에 boardList): 표의 본문 줄(`tbody`) 전부
 * 표 제목(caption)·열 이름(thead)·미리보기 상자의 제목과 [더보기]는 게시판 데이터가 아닌 화면 글자라 수집한다.
 */
const BOARD_DATA_ALWAYS = '[id^="board"][id$="List"]';
const BOARD_DATA_ON_BOARD_PAGE = `${BOARD_DATA_ALWAYS}, tbody`;

/** 게시판 목록이 있는 페이지인지 (주소에 boardList가 들어감) */
export function isBoardPage(url: string): boolean {
  return /boardList/i.test(url);
}

/** 지연 로딩 그림까지 불러오도록 페이지를 끝까지 스크롤한다 */
async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 800) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
}

/**
 * 페이지 안에서 실행되는 읽기 함수.
 * 브라우저로 보내져 실행되므로 이 함수 밖의 변수·함수를 쓰면 안 된다.
 */
function readItemsInPage(boardDataSelector: string): RawItem[] {
  const items: RawItem[] = [];

  // 문구 정리: 연속된 띄어쓰기·줄바꿈을 한 칸으로, 앞뒤 공백 제거. 한글·영문이 없으면 버린다
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const hasWords = (s: string) => /[가-힣A-Za-z]/.test(s);

  // 영역 판단: header·gnb → 상단, footer → 하단, 나머지 → 본문
  const regionOf = (el: Element): RawItem['region'] => {
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
      const name = `${typeof e.className === 'string' ? e.className : ''} ${e.id}`;
      const tag = e.tagName.toLowerCase();
      if (tag === 'header' || /(^|[\s_-])(header|gnb)/i.test(name)) return '상단';
      if (tag === 'footer' || /footer/i.test(name)) return '하단';
    }
    return '본문';
  };

  // 숨김 판단: 크기 0, display:none, visibility:hidden, 자신이나 조상의 투명도 0
  const isHidden = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return true;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
      if (getComputedStyle(e).opacity === '0') return true;
    }
    return false;
  };

  // 같은 페이지·같은 영역의 똑같은 항목은 한 번만 남긴다
  const seen = new Set<string>();
  const add = (el: Element, item: Omit<RawItem, 'region' | 'hidden'>) => {
    const full: RawItem = { ...item, region: regionOf(el), hidden: isHidden(el) };
    const key = [full.kind, full.value, full.region, full.hidden].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    items.push(full);
  };

  // 읽지 않는 곳: 화면에 안 그려지는 태그 + 게시판 데이터 영역
  const SKIP = `script, style, noscript, template, iframe, option, ${boardDataSelector}`;

  // 1) 문구: 굵은 글씨 등으로 쪼개지지 않도록 가장 가까운 블록 요소 단위로 모은다(textContent 방식)
  const isInline = (el: Element) => getComputedStyle(el).display === 'inline';
  const textByBlock = new Map<Element, string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue?.trim() || parent.closest(SKIP)) continue;
    let block: Element = parent;
    while (block !== document.body && block.parentElement && isInline(block)) block = block.parentElement;
    textByBlock.set(block, (textByBlock.get(block) ?? '') + node.nodeValue);
  }
  for (const [block, raw] of textByBlock) {
    const value = normalize(raw);
    if (hasWords(value)) add(block, { kind: '문구', value });
  }

  // 2) 버튼 글자 (<input type="button|submit">)
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="button"], input[type="submit"]')) {
    if (input.closest(SKIP)) continue;
    const value = normalize(input.value);
    if (hasWords(value)) add(input, { kind: '문구', value });
  }

  // 3) 이미지: <img> 태그
  for (const img of document.querySelectorAll('img')) {
    if (img.closest(SKIP) || !img.getAttribute('src')) continue;
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:')) continue;
    add(img, { kind: '이미지', value: src, alt: normalize(img.alt) || undefined });
  }

  // 4) 이미지: CSS 배경 이미지
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest(SKIP)) continue;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      if (m[1].startsWith('data:')) continue;
      add(el, { kind: '이미지', value: new URL(m[1], location.href).href });
    }
  }

  return items;
}

/** 열린 페이지에서 이미지·문구를 읽는다 (collect.ts의 Extractor 자리에 들어간다) */
export async function extractPageItems(page: Page, target: PageTarget): Promise<RawItem[]> {
  await scrollToBottom(page);
  const boardData = isBoardPage(target.url) ? BOARD_DATA_ON_BOARD_PAGE : BOARD_DATA_ALWAYS;
  return page.evaluate(readItemsInPage, boardData);
}
