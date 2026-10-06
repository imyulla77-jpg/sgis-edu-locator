// [화면] 결과 검색 — 순수 계산 (DESIGN.md 4.3장, PLAN 작업 19)
// - 검색 대상: 내용(문구) · 이미지 파일 이름 · 대체텍스트 · 메뉴 이름. 대소문자는 구분하지 않는다
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

/** 내용·파일 이름·대체텍스트 (소문자로) */
function contentText(group: Group): string {
  return `${group.display}\n${group.alt ?? ''}`.toLowerCase();
}

/** 메뉴 이름들 (소문자로) */
function menuText(group: Group): string {
  return group.locations.map((l) => l.menu).join('\n').toLowerCase();
}

export function searchGroups(groups: Group[], { query, kind, scope }: SearchInput): SearchOutput {
  const q = query.trim().toLowerCase();
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
