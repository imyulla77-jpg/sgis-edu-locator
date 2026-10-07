// [화면] 엑셀 다운로드 도우미 (DESIGN.md 4.3·8·9·16장, PLAN 작업 22·23·26)
// 엑셀 도구(exceljs)를 불러오지 않는 가벼운 파일이라, 화면이 처음부터 불러와도 무겁지 않다.
// 엑셀 도구와 미리보기 만들기는 [엑셀 다운로드]를 누를 때 downloadExcel 안에서 불러온다(DESIGN.md 3장).

import type { ExcelInput } from './excel.ts';
import type { PageResult } from './types.ts';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 다운로드 전에 띄울 경고 문장. 수집 실패 페이지가 없으면 null (PRD must 2)
 * "시간 초과"는 지휘 단계에서 다시 보낸 뒤에도 남으면 "수집 실패"로 바뀌지만, 혹시 남아 있으면 함께 센다.
 */
export function failureWarning(results: PageResult[]): string | null {
  const failed = results.filter((r) => r.status !== '성공').length;
  if (failed === 0) return null;
  return `수집 실패 ${failed}개 페이지가 있어요. 그 페이지의 위치는 엑셀에 빠져 있어요.\n(실패 목록은 엑셀 "안내" 시트 맨 위에 적혀 있어요)\n\n그래도 받을까요?`;
}

/** 파일 이름: SGIS에듀_공통위치_YYYY-MM-DD.xlsx (내려받는 날, 담당자 PC의 날짜) (PRD must 2) */
export function excelFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `SGIS에듀_공통위치_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.xlsx`;
}

/** 브라우저에서 파일로 저장한다 */
function saveFile(bytes: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_TYPE }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 다운로드가 시작될 시간을 준 뒤 정리한다
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 다운로드 진행 상황 (버튼 글자에 씀) */
export type DownloadStatus = { step: '그림 준비'; done: number; total: number } | { step: '엑셀 만들기' };

/**
 * [엑셀 다운로드]: 실패 페이지가 있으면 먼저 확인창을 띄우고,
 * 그림 미리보기를 만든 뒤(PLAN 작업 26) 엑셀을 만들어 내려받는다.
 * 확인창에서 취소하면 false, 내려받기를 시작하면 true.
 */
export async function downloadExcel(
  input: ExcelInput,
  onStatus?: (status: DownloadStatus) => void,
): Promise<boolean> {
  const warning = failureWarning(input.results);
  if (warning && !window.confirm(warning)) return false;

  // 그림 묶음의 미리보기(긴 변 60픽셀) — 실패한 그림은 엑셀에 "미리보기 없음"
  const { makeThumbnails } = await import('./thumbnail.ts');
  const imageUrls = input.groups.filter((g) => g.kind === '이미지' && g.imageUrl).map((g) => g.imageUrl!);
  onStatus?.({ step: '그림 준비', done: 0, total: imageUrls.length });
  const thumbnails = await makeThumbnails(imageUrls, (done, total) => onStatus?.({ step: '그림 준비', done, total }));

  onStatus?.({ step: '엑셀 만들기' });
  const { buildWorkbook } = await import('./excel.ts'); // 이때 처음 엑셀 도구를 불러온다
  const bytes = await buildWorkbook({ ...input, thumbnails });
  saveFile(bytes, excelFileName());
  return true;
}
