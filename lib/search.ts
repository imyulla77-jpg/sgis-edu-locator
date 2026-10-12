// [화면] 결과 검색 — 순수 계산 (DESIGN.md 4.3장, PLAN 작업 19)
// - 검색 대상: 내용(문구) · 이미지 파일 이름 · 대체텍스트 · 메뉴 이름. 대소문자는 구분하지 않는다
// - 띄어쓰기·줄바꿈은 무시하고 찾는다. 사이트나 엑셀에서 복사한 문구에 줄바꿈이 끼거나
//   띄어쓰기가 조금 달라도 찾을 수 있게 하기 위함(2026-10-12 사용성 개선)
// - 건수 세는 단위: 공통ID 1개 = 1건. "전체 N건"과 "최대 100건 표시" 모두 공통ID 기준
// - 필터 2개: 구분(전체/이미지/문구), 과정(전체/3과정 공통). 검색어와 함께 적용
// - 검색어가 비어 있으면 필터만 적용한 전체 목록을, 1글자면 "2글자 이상" 안내를 돌려준다
// - 순서: 내용·파일 이름·대체텍스트에서 찾은 것을 먼저, 메뉴 이름으로만 걸린 것을 뒤에(각각 공통ID 순서)
//   메뉴 이름을 검색하면 그 메뉴 페이지의 모든 항목이 걸려서, 찾는 그림·문구가 뒤로 밀리지 않게 하기 위함

import type { Group } from './types.ts';
import { COURSES } from './types.ts';

/** 검색어 최소 글자 수 (PRD must 2) */
export const MIN_QUERY_LENGTH = 2;

/** 한 번에 보여 주는 최대 건수 (PRD must 2) */
export const MAX_SHOWN = 100;

export type KindFilter = '전체' | '이미지' | '문구';
export type ScopeFilter = '전체' | '3과정 공통';

export interface SearchInput {
  query: string;
  kind: KindFilter;
  scope: ScopeFilter;
}

export type SearchOutput =
  | { status: '짧음' } // 검색어가 1글자
  | { status: '결과'; total: number; shown: Group[] };

/** 띄어쓰기·줄바꿈을 모두 빼고 소문자로 바꾼다 (검색어와 검색 대상에 똑같이 적용) */
export function squash(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/** 내용·파일 이름·대체텍스트. 서로 이어 붙어 엉뚱하게 걸리지 않도록 '|'로 나눈다 */
function contentText(group: Group): string {
  return `${squash(group.display)}|${squash(group.alt ?? '')}`;
}

/** 메뉴 이름들 */
function menuText(group: Group): string {
  return group.locations.map((l) => squash(l.menu)).join('|');
}

export function searchGroups(groups: Group[], { query, kind, scope }: SearchInput): SearchOutput {
  const q = squash(query);
  if (q.length > 0 && q.length < MIN_QUERY_LENGTH) return { status: '짧음' };

  const filtered = groups.filter(
    (g) => (kind === '전체' || g.kind === kind) && (scope === '전체' || g.courses.length === COURSES.length),
  );
  if (q === '') return { status: '결과', total: filtered.length, shown: filtered.slice(0, MAX_SHOWN) };

  const byContent = filtered.filter((g) => contentText(g).includes(q));
  const byMenuOnly = filtered.filter((g) => !contentText(g).includes(q) && menuText(g).includes(q));
  const matched = [...byContent, ...byMenuOnly];
  return { status: '결과', total: matched.length, shown: matched.slice(0, MAX_SHOWN) };
}
