// [화면] 엑셀 다운로드 도우미 (DESIGN.md 4.3·8·9장, PLAN 작업 22)
// 엑셀 도구(exceljs)를 불러오지 않는 가벼운 파일이라, 화면이 처음부터 불러와도 무겁지 않다.
// 파일 이름·실제 다운로드(작업 23)는 다음 작업에서 더한다.

import type { PageResult } from './types.ts';

/**
 * 다운로드 전에 띄울 경고 문장. 수집 실패 페이지가 없으면 null (PRD must 2)
 * "시간 초과"는 지휘 단계에서 다시 보낸 뒤에도 남으면 "수집 실패"로 바뀌지만, 혹시 남아 있으면 함께 센다.
 */
export function failureWarning(results: PageResult[]): string | null {
  const failed = results.filter((r) => r.status !== '성공').length;
  if (failed === 0) return null;
  return `수집 실패 ${failed}개 페이지가 있어요. 그 페이지의 위치는 엑셀에 빠져 있어요.\n(실패 목록은 엑셀 "안내" 시트 맨 위에 적혀 있어요)\n\n그래도 받을까요?`;
}
