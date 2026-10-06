// [화면] 같은 항목 묶기 — 순수 계산 (DESIGN.md 5장 ④·6장, PLAN 작업 11)
// 수집 결과(PageResult[])를 받아 같은 문구끼리 묶는다.
// 이미지 묶기(파일 지문 기준)와 공통ID 매기기는 PLAN 작업 12에서 이 파일에 더한다.
//
// 브라우저 없이 계산만 하므로 화면에서도, scripts/에서도 불러올 수 있다.
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Course, Group, Location, PageResult } from './types.ts';
import { COURSES } from './types.ts';

/** 공통ID를 매기기 전의 묶음 (작업 12에서 id를 붙여 Group이 된다) */
export type DraftGroup = Omit<Group, 'id'>;

/**
 * 문구 정리 규칙 (DESIGN.md 6장): 연속된 띄어쓰기·줄바꿈을 한 칸으로 줄이고 앞뒤 공백을 지운다.
 * 수집할 때(extract.ts)도 같은 규칙으로 정리하지만, 묶는 기준이 흔들리지 않도록 여기서 한 번 더 적용한다.
 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 한글·영문이 하나도 없는 글자(숫자·기호만)는 버린다 */
function hasWords(text: string): boolean {
  return /[가-힣A-Za-z]/.test(text);
}

/**
 * 묶음에 위치를 더한다.
 * PRD의 위치는 메뉴 · 페이지 주소 · 영역 3가지라서, 같은 과정·주소·영역이면 한 위치로 본다.
 * 그 위치에서 한 번이라도 보이면 "보임", 모두 숨어 있을 때만 "숨김"으로 남긴다.
 */
function addLocation(group: DraftGroup, location: Location): void {
  const same = group.locations.find(
    (l) => l.course === location.course && l.url === location.url && l.region === location.region,
  );
  if (same) {
    same.hidden = same.hidden && location.hidden;
    return;
  }
  group.locations.push(location);
  if (!group.courses.includes(location.course)) {
    group.courses.push(location.course);
    group.courses.sort((a: Course, b: Course) => COURSES.indexOf(a) - COURSES.indexOf(b));
  }
}

/**
 * 수집 결과에서 문구를 같은 것끼리 묶는다.
 * - 묶는 기준: 'T:' + 정리한 글자 (글자가 완전히 같을 때만 같은 항목)
 * - "성공"한 페이지의 항목만 쓴다
 * - 묶음 순서는 처음 나온 순서 (공통 범위별 정렬은 작업 12에서)
 */
export function groupTexts(results: PageResult[]): DraftGroup[] {
  const groups = new Map<string, DraftGroup>();
  for (const result of results) {
    if (result.status !== '성공') continue;
    const { course, menu, url } = result.target;
    for (const item of result.items) {
      if (item.kind !== '문구') continue;
      const text = normalizeText(item.value);
      if (!hasWords(text)) continue;
      const key = `T:${text}`;
      let group = groups.get(key);
      if (!group) {
        group = { kind: '문구', key, display: text, comparable: true, courses: [], locations: [] };
        groups.set(key, group);
      }
      addLocation(group, { course, menu, url, region: item.region, hidden: item.hidden });
    }
  }
  return [...groups.values()];
}
