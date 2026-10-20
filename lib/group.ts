// 같은 그림·문장 묶기와 그룹ID 매기기 — 시트 2(정렬)·시트 3·4(검토할 이미지·텍스트)용 (DESIGN.md 9장, PLAN 작업 19·20)
// - 같은 그림: 그림 파일 내용 지문(sha256)이 완전히 같을 때만. 지문을 못 구한 그림은 주소별로 따로
// - 같은 문장: 띄어쓰기를 정리한 뒤 글자가 완전히 같을 때만. 비슷하기만 한 것은 묶지 않는다
// - 그룹ID는 시트 1에서 처음 나온 순서대로 IMG-001…, TXT-001…
// 브라우저 없이 계산만 하므로 화면과 개발용 실행(scripts/)이 함께 쓴다.
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Course, Level2, RecordRow } from './refresh-types.ts';
import { COURSES } from './refresh-types.ts';

/** 문장 비교용: 연속된 띄어쓰기·줄바꿈을 한 칸으로, 앞뒤 공백 제거 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 행이 속한 묶음의 열쇠 */
export function groupKey(row: RecordRow): string {
  if (row.kind === '그림') return row.sha256 ? `img:${row.sha256}` : `src:${row.src ?? ''}`;
  return `txt:${normalizeText(row.before ?? '')}`;
}

/** 그룹 하나 */
export interface RecordGroup {
  id: string;
  kind: RecordRow['kind'];
  /** 이 그룹의 시트 1 행 (시트 1 순서) */
  rows: RecordRow[];
  /** 나온 과정 (초등·중학·고교 순서) */
  courses: Course[];
}

/** 시트 1 행을 그룹으로 묶는다. 결과는 그룹ID 순서(그림 그룹 → 문장 그룹) */
export function groupRecords(records: RecordRow[]): RecordGroup[] {
  const byKey = new Map<string, RecordRow[]>();
  for (const row of records) {
    const key = groupKey(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  const groups: RecordGroup[] = [];
  const counters = { 그림: 0, 문장: 0 };
  for (const rows of byKey.values()) {
    const kind = rows[0].kind;
    counters[kind] += 1;
    const id = `${kind === '그림' ? 'IMG' : 'TXT'}-${String(counters[kind]).padStart(3, '0')}`;
    const courses = COURSES.filter((c) => rows.some((r) => r.location.course === c));
    groups.push({ id, kind, rows, courses });
  }
  return [...groups.filter((g) => g.kind === '그림'), ...groups.filter((g) => g.kind === '문장')];
}

const LEVEL2_ORDER: Level2[] = ['수업하기', '스스로하기', '주제보기'];

/**
 * 시트 2 순서: 구분(그림 먼저) → 그룹ID → 과정(초등·중학·고교) → 2단계 → 3단계 → 시트 1 순번.
 * 결과는 [그룹, 행] 짝 목록 (같은 그룹 행이 붙어 나온다)
 */
export function sortedForSheet2(groups: RecordGroup[]): { group: RecordGroup; row: RecordRow }[] {
  const out: { group: RecordGroup; row: RecordRow }[] = [];
  for (const group of groups) {
    const rows = [...group.rows].sort(
      (a, b) =>
        COURSES.indexOf(a.location.course) - COURSES.indexOf(b.location.course) ||
        LEVEL2_ORDER.indexOf(a.location.level2) - LEVEL2_ORDER.indexOf(b.location.level2) ||
        a.location.level3.localeCompare(b.location.level3, 'ko') ||
        a.no - b.no,
    );
    for (const row of rows) out.push({ group, row });
  }
  return out;
}
