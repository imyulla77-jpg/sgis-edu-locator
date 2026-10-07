// [화면] 메뉴 골라서 수집 — 순수 계산 (PRD nice 3, PLAN 작업 25, DESIGN.md 15장)
// 묶음 목록에서 "상단 메뉴"(메인·수업하기·함께하기…)를 뽑아 보여 주고,
// 고른 상단 메뉴의 묶음만 남긴다. 고른 메뉴는 초등·중학·고교 세 과정 모두에서 수집한다(담당자 결정: 상단 메뉴 단위).
// 메뉴 이름은 코드에 적어 두지 않고 사이트에서 읽은 묶음 목록에서 꺼낸다.
//
// scripts/에서도 불러올 수 있도록 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Batch, Course } from './types.ts';
import { COURSES } from './types.ts';

/** 상단 메뉴 하나와 과정별 페이지 수 */
export interface MenuGroup {
  /** 상단 메뉴 이름. 예: "메인", "주제보기" */
  name: string;
  /** 세 과정 합계 페이지 수 */
  pages: number;
  /** 과정별 페이지 수 */
  byCourse: Record<Course, number>;
}

/** 수집 대상의 메뉴 경로에서 상단 메뉴 이름을 꺼낸다. 예: "주제보기 > 가정과 다문화" → "주제보기" */
export function topMenuOf(menu: string): string {
  return menu.split(' > ')[0].trim();
}

/** 묶음 하나가 속한 상단 메뉴 (묶음은 같은 과정·같은 상단 메뉴의 페이지로만 이루어짐) */
function topMenuOfBatch(batch: Batch): string {
  return topMenuOf(batch.pages[0]?.menu ?? batch.label);
}

/** 묶음 목록에 나오는 상단 메뉴를 처음 나온 순서대로 모은다 */
export function listMenuGroups(batches: Batch[]): MenuGroup[] {
  const groups = new Map<string, MenuGroup>();
  for (const batch of batches) {
    const name = topMenuOfBatch(batch);
    let group = groups.get(name);
    if (!group) {
      group = { name, pages: 0, byCourse: Object.fromEntries(COURSES.map((c) => [c, 0])) as Record<Course, number> };
      groups.set(name, group);
    }
    group.pages += batch.pages.length;
    group.byCourse[batch.course] += batch.pages.length;
  }
  return [...groups.values()];
}

/** 고른 상단 메뉴의 묶음만 남긴다 (원래 순서 유지) */
export function pickBatches(batches: Batch[], selected: Iterable<string>): Batch[] {
  const names = new Set(selected);
  return batches.filter((b) => names.has(topMenuOfBatch(b)));
}
