// 바로가기 버튼 → SGIS 홈페이지 경로 (DESIGN.md 2.3장, PLAN 작업 11)
// 브라우저 없이 계산만 하므로 화면과 서버가 함께 쓴다.
// 맞추는 순서: ① 주소(물음표·# 앞)가 홈페이지 메뉴와 똑같음 → ② 같은 폴더(마지막 / 앞)의 메뉴 → ③ 버튼 문구
// 4개 메뉴(통계주제도·대화형 통계지도·활용서비스·분석지도)가 아니면 "홈페이지 경로 없음"(menu: null). 짐작해 지어내지 않는다.
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { DirectButton, HomeLink, HomeMenu, HomeMenuItem } from './refresh-types.ts';

const HOME_MENUS: HomeMenu[] = ['통계주제도', '대화형 통계지도', '활용서비스', '분석지도'];

const squash = (s: string) => s.replace(/\s+/g, '');

/** 주소의 경로 부분 (물음표·# 뒤를 뗌). 읽을 수 없으면 빈 글자 */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** 주소의 theme 값 (통계주제도 주제 구분, 예: CTGR_005). 없으면 null */
function themeOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get('theme');
  } catch {
    return null;
  }
}

/** 경로의 폴더 부분. 예: /jsp/pyramid/pyramid2.jsp → /jsp/pyramid/ */
function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/**
 * 버튼 문구에서 메뉴와 하위 이름을 읽는다.
 * 예: "SGIS ｢분석지도(지방의 변화보기)｣ 바로가기" → { menu: 분석지도, sub: 지방의 변화보기 }
 *     "SGIS 대화형통계지도(e-지방지표) 바로가기" → { menu: 대화형 통계지도, sub: e-지방지표 }
 */
export function parseButtonText(text: string): { menu: HomeMenu | null; sub: string } {
  const cleaned = text
    .replace(/바로\s*가기/g, '')
    .replace(/[｢｣「」『』"']/g, '')
    .replace(/^\s*SGIS\s*/i, '')
    .trim();
  const m = cleaned.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const head = squash(m ? m[1] : cleaned);
  const sub = (m ? m[2] : '').trim();
  const menu = HOME_MENUS.find((name) => head === squash(name)) ?? null;
  return { menu, sub };
}

/** 버튼 하나를 홈페이지 경로로 바꾼다 */
export function resolveHomeLink(button: DirectButton, homeMenus: HomeMenuItem[]): HomeLink {
  const path = pathOf(button.url);
  const fromText = parseButtonText(button.text);
  /** 주소로 찾은 메뉴가 버튼 문구의 메뉴와 다르면(홈페이지 메뉴가 옮겨진 경우 등) 비고에 남긴다 */
  const withMenuNote = (link: HomeLink): HomeLink =>
    fromText.menu && link.menu && fromText.menu !== link.menu
      ? { ...link, note: [link.note, `버튼 문구는 "${fromText.menu}"이지만 현재 홈페이지 메뉴 기준`].filter(Boolean).join(' / ') }
      : link;

  // ① 주소(경로)가 똑같은 홈페이지 메뉴. 통계주제도처럼 경로가 같고 뒤의 값(theme=…)만 다른 메뉴가 여러 개면
  //    theme 값이 같은 것 → 버튼 문구의 하위 이름이 같은 것 순서로 고른다. 그래도 못 고르면 ③ 버튼 문구로 넘어간다
  const samePath = path ? homeMenus.filter((item) => pathOf(item.url) === path) : [];
  const exact =
    samePath.length === 1
      ? samePath[0]
      : (samePath.find((item) => themeOf(item.url) !== null && themeOf(item.url) === themeOf(button.url)) ??
        samePath.find((item) => squash(item.name) === squash(fromText.sub)));
  if (exact) return withMenuNote({ menu: exact.menu, sub: exact.name, url: button.url });

  // ② 같은 폴더의 홈페이지 메뉴 (예: pyramid2.jsp ↔ 메뉴 pyramid1.jsp). 여러 개면 버튼 문구의 이름과 같은 것
  //    (경로가 똑같은 메뉴가 여러 개인데 못 고른 경우는 이 단계를 건너뛴다)
  const sameFolder =
    path && samePath.length === 0 ? homeMenus.filter((item) => folderOf(pathOf(item.url)) === folderOf(path) && folderOf(path) !== '/') : [];
  if (sameFolder.length > 0) {
    const named = sameFolder.find((item) => squash(item.name) === squash(fromText.sub)) ?? sameFolder[0];
    return withMenuNote({ menu: named.menu, sub: named.name, url: button.url, note: '주소가 홈페이지 메뉴와 조금 달라 같은 폴더의 메뉴로 맞춤' });
  }

  // ③ 버튼 문구
  if (fromText.menu) return { menu: fromText.menu, sub: fromText.sub, url: button.url, note: '버튼 문구 기준' };

  return { menu: null, sub: fromText.sub, url: button.url, note: '4개 메뉴(통계주제도·대화형 통계지도·활용서비스·분석지도) 밖의 주소' };
}
