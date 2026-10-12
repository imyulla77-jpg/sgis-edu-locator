// [화면] 같은 항목 묶기·공통ID — 순수 계산 (DESIGN.md 5장 ④·6장, PLAN 작업 11·12)
// 수집 결과(PageResult[])를 받아
//  - 문구는 정리한 글자가 완전히 같을 때 (작업 11)
//  - 이미지는 파일 지문이 같을 때, 지문이 없으면("비교 불가") 그림 주소가 완전히 같을 때 (작업 12)
// 같은 항목으로 묶고, 공통ID(IMG-001 / TXT-001)를 매긴다 (작업 12).
//
// 브라우저 없이 계산만 하므로 화면에서도, scripts/에서도 불러올 수 있다.
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Course, Group, ItemKind, Location, PageResult, RawItem } from './types.ts';
import { COURSES } from './types.ts';

/** 공통ID를 매기기 전의 묶음 */
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

/** 그림 주소에서 화면에 보여 줄 파일 이름을 꺼낸다. 예: .../images/logo.png?v=1 → logo.png */
export function imageFileName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}

/**
 * 같은 수집 안에서 그림 주소 → 처음 받은 파일 지문.
 * 한 곳에서 지문을 받지 못했어도(묶음 시간이 거의 다 됐거나 잠깐 실패) 같은 주소의 지문을 다른 곳에서 받았으면
 * 그 지문을 빌려 쓴다. 그래야 같은 그림이 "I:지문"과 "U:주소"로 쪼개져 3과정 공통이 2과정·1과정으로
 * 나뉘거나, 지난 결과 비교에서 "새로 생김 + 사라짐"으로 잘못 나오지 않는다(CHECK.md Gap #4).
 */
function hashesByUrl(results: PageResult[]): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const result of results) {
    if (result.status !== '성공') continue;
    for (const item of result.items) {
      if (item.kind === '이미지' && item.hash && !hashes.has(item.value)) hashes.set(item.value, item.hash);
    }
  }
  return hashes;
}

/** 항목 하나의 묶는 기준과 처음 만들 묶음. 묶지 않는 항목이면 null */
function draftOf(item: RawItem, hashes: Map<string, string>): DraftGroup | null {
  if (item.kind === '문구') {
    const text = normalizeText(item.value);
    if (!hasWords(text)) return null;
    return { kind: '문구', key: `T:${text}`, display: text, comparable: true, courses: [], locations: [] };
  }
  // 이미지: 지문이 있으면 지문으로(이 위치에서 못 받았으면 같은 주소에서 받은 지문),
  // 끝내 없으면("비교 불가") 주소가 완전히 같을 때만 같은 항목
  const hash = item.hash ?? hashes.get(item.value);
  return {
    kind: '이미지',
    key: hash ? `I:${hash}` : `U:${item.value}`,
    display: imageFileName(item.value),
    imageUrl: item.value,
    alt: item.alt || undefined,
    comparable: Boolean(hash),
    courses: [],
    locations: [],
  };
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

/** 수집 결과를 처음 나온 순서대로 훑으며 묶는다. "성공"한 페이지의 항목만 쓴다 */
function draftGroups(results: PageResult[], kinds: ItemKind[]): DraftGroup[] {
  const groups = new Map<string, DraftGroup>(); // Map은 넣은 순서 = 처음 나온 순서를 지킨다
  const hashes = hashesByUrl(results);
  for (const result of results) {
    if (result.status !== '성공') continue;
    const { course, menu, url } = result.target;
    for (const item of result.items) {
      if (!kinds.includes(item.kind)) continue;
      const draft = draftOf(item, hashes);
      if (!draft) continue;
      let group = groups.get(draft.key);
      if (!group) {
        group = draft;
        groups.set(draft.key, group);
      } else if (draft.alt && !group.alt) {
        group.alt = draft.alt; // 대체텍스트는 처음 발견된 것을 쓴다
      }
      addLocation(group, { course, menu, url, region: item.region, hidden: item.hidden });
    }
  }
  return [...groups.values()];
}

/** 문구만 묶는다 (작업 11). 공통ID는 매기지 않는다 */
export function groupTexts(results: PageResult[]): DraftGroup[] {
  return draftGroups(results, ['문구']);
}

/** 이미지만 묶는다 (작업 12). 공통ID는 매기지 않는다 */
export function groupImages(results: PageResult[]): DraftGroup[] {
  return draftGroups(results, ['이미지']);
}

/**
 * 이미지와 문구를 모두 묶고 공통ID를 매긴다 (작업 12).
 * 순서(= 공통ID 매기는 순서, DESIGN.md 6장):
 *   1. 있는 과정 수가 많은 것부터 (3과정 공통 → 2과정 → 한 과정만)
 *   2. 그 안에서 이미지 → 문구
 *   3. 그 안에서 처음 나온 순서
 * 공통ID는 이미지와 문구를 따로 센다: IMG-001, IMG-002 … / TXT-001, TXT-002 …
 */
export function buildGroups(results: PageResult[]): Group[] {
  const drafts = draftGroups(results, ['이미지', '문구']);
  const firstSeen = new Map(drafts.map((d, i) => [d, i]));
  const kindOrder = (k: ItemKind) => (k === '이미지' ? 0 : 1);
  const sorted = [...drafts].sort(
    (a, b) =>
      b.courses.length - a.courses.length ||
      kindOrder(a.kind) - kindOrder(b.kind) ||
      firstSeen.get(a)! - firstSeen.get(b)!,
  );

  let imageCount = 0;
  let textCount = 0;
  return sorted.map((draft) => {
    const number = draft.kind === '이미지' ? ++imageCount : ++textCount;
    const prefix = draft.kind === '이미지' ? 'IMG' : 'TXT';
    return { id: `${prefix}-${String(number).padStart(3, '0')}`, ...draft };
  });
}
