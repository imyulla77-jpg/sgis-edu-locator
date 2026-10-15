// "사이트 접속 불가" 판단 — 화면과 개발용 실행(scripts/)이 함께 쓴다 (PRD must 1)
// 브라우저 없이 결과 목록만 보고 계산하므로 화면 쪽에서도 불러올 수 있다.
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

/** 처음 몇 페이지를 보고 판단하는지 (PRD: 처음 3개 페이지) */
export const FIRST_PAGES_TO_CHECK = 3;

/** 사이트에 접속할 수 없을 때 보여 줄 안내 */
export const SITE_UNAVAILABLE_MESSAGE = '사이트 접속 불가 — 잠시 후 다시 시도하세요';

/**
 * 수집 순서대로 쌓인 결과를 받아, 처음 3개 페이지가 연달아 실패했으면 true를 돌려준다.
 * - "수집 실패"와 "시간 초과"를 모두 실패로 본다
 * - 아직 3개가 모이지 않았거나, 처음 3개 중 하나라도 성공했으면 false
 */
export function isSiteUnavailable(resultsInOrder: { status: string }[]): boolean {
  const first = resultsInOrder.slice(0, FIRST_PAGES_TO_CHECK);
  return first.length === FIRST_PAGES_TO_CHECK && first.every((r) => r.status !== '성공');
}
