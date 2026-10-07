// [화면] 지난 수집 결과와 비교 — 순수 계산 (PRD nice 1, PLAN 작업 27, DESIGN.md 17장)
// PRD 규칙: 비교는 공통ID가 아니라 이미지 파일 내용(지문)과 문구 글자로 한다(공통ID는 수집할 때마다 새로 매겨지므로).
//  - 지난 엑셀에 "비교 기준" 열이 있으면(이 기능 이후 만든 엑셀) 묶는 기준(key)끼리 비교: 'I:'+지문 / 'U:'+그림 주소 / 'T:'+문구
//  - 없으면(이전에 만든 엑셀) 그림은 주소, 문구는 글자로 비교한다 — 파일 이름만 바뀐 같은 그림은 "새로 생김·사라짐"으로 보일 수 있음
//
// scripts/에서도 불러올 수 있도록 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import { normalizeText } from './group.ts';
import type { Group, ItemKind } from './types.ts';

/** 지난 엑셀에서 읽은 항목 하나 */
export interface PastItem {
  /** 비교 기준. 지난 엑셀에 "비교 기준" 열이 없으면 그림 주소·문구로 만든 대체 기준 */
  key: string;
  kind: ItemKind;
  /** 내용(문구 / 그림 파일 이름) */
  display: string;
  imageUrl?: string;
  /** 있던 과정. 예: "초등·중학·고교" */
  courses: string;
}

/** 지난 엑셀에서 읽은 내용 */
export interface PastResult {
  /** 지난 엑셀 파일 이름 */
  fileName: string;
  /** 지난 조사 일시(안내 시트 글자 그대로) */
  collectedAt: string;
  /** 지난 조사 범위(안내 시트 글자 그대로) */
  scope: string;
  /** "비교 기준" 열이 있었는지. 없으면 그림을 주소로 비교한다 */
  hasKeys: boolean;
  items: PastItem[];
}

/** 비교 결과 */
export interface Comparison {
  past: Pick<PastResult, 'fileName' | 'collectedAt' | 'scope' | 'hasKeys'>;
  /** 이번에 새로 생긴 항목의 공통ID */
  addedIds: string[];
  /** 지난번에는 있었는데 이번에 없는 항목 */
  removed: PastItem[];
  /** 이번이나 지난번 중 하나가 일부 메뉴만 수집해서 "사라짐"이 정확하지 않을 수 있음 */
  partial: boolean;
}

/** 이전 엑셀처럼 "비교 기준"이 없을 때 쓰는 대체 기준: 그림은 주소, 문구는 정리한 글자 */
export function fallbackKey(kind: ItemKind, display: string, imageUrl?: string): string {
  return kind === '이미지' ? `U:${imageUrl ?? display}` : `T:${normalizeText(display)}`;
}

/** 이번 묶음을 지난 엑셀과 같은 방식의 기준으로 바꾼다 */
function currentKey(group: Group, hasKeys: boolean): string {
  return hasKeys ? group.key : fallbackKey(group.kind, group.display, group.imageUrl);
}

/**
 * 이번 결과(groups)와 지난 결과를 비교한다.
 * - 새로 생김: 이번에 있고 지난번에 없는 것
 * - 사라짐: 지난번에 있고 이번에 없는 것
 * currentPartial: 이번 수집을 일부 메뉴만 했는지 (지난 조사 범위는 안내 시트 글자로 판단)
 */
export function compareWithPast(groups: Group[], past: PastResult, currentPartial: boolean): Comparison {
  const pastKeys = new Set(past.items.map((i) => i.key));
  const nowKeys = new Set(groups.map((g) => currentKey(g, past.hasKeys)));
  return {
    past: { fileName: past.fileName, collectedAt: past.collectedAt, scope: past.scope, hasKeys: past.hasKeys },
    addedIds: groups.filter((g) => !pastKeys.has(currentKey(g, past.hasKeys))).map((g) => g.id),
    removed: past.items.filter((i) => !nowKeys.has(i.key)),
    partial: currentPartial || past.scope.startsWith('일부 메뉴만'),
  };
}
