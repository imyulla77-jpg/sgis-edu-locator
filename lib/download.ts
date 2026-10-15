// [화면] 엑셀 다운로드 도우미 (DESIGN.md 9장, PRD must 2, PLAN 작업 21)
// 엑셀 도구(exceljs)를 불러오지 않는 가벼운 파일이라 화면이 처음부터 불러와도 무겁지 않다.
// 엑셀 도구는 [엑셀 다운로드]를 누를 때 downloadExcel 안에서 불러온다.

import type { ExcelInput } from './excel.ts';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 다운로드 전에 띄울 경고 문장. 수집 실패 페이지·확인 필요 그림이 없으면 null (PRD must 2) */
export function downloadWarning(input: Pick<ExcelInput, 'results' | 'judgements'>): string | null {
  const failed = input.results.filter((r) => r.status !== '성공').length;
  const unsure = [...input.judgements.values()].filter((j) => j.verdict === '확인 필요').length;
  if (failed === 0 && unsure === 0) return null;
  const lines = [
    failed > 0 ? `· 수집 실패 ${failed}개 페이지가 있어요. 그 페이지의 그림·문장은 엑셀에 빠져 있어요.` : '',
    unsure > 0 ? `· AI가 판단하지 못한 그림(확인 필요) ${unsure}개가 있어요. 첫 번째 시트에 "확인 필요"로 들어가요.` : '',
  ].filter(Boolean);
  return `${lines.join('\n')}\n(목록은 엑셀 "수집_기록" 시트에 적혀 있어요)\n\n그래도 받을까요?`;
}

/** 파일 이름: SGIS에듀_현행화대상_YYYY-MM-DD.xlsx (내려받는 날, 담당자 PC의 날짜) (PRD must 2) */
export function excelFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `SGIS에듀_현행화대상_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.xlsx`;
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

/**
 * [엑셀 다운로드]: 실패 페이지·확인 필요 그림이 있으면 먼저 확인창을 띄우고, 엑셀을 만들어 내려받는다.
 * 확인창에서 취소하면 false, 내려받기를 시작하면 true.
 */
export async function downloadExcel(input: ExcelInput): Promise<boolean> {
  const warning = downloadWarning(input);
  if (warning && !window.confirm(warning)) return false;
  const { buildWorkbook } = await import('./excel.ts'); // 이때 처음 엑셀 도구를 불러온다
  saveFile(await buildWorkbook(input), excelFileName());
  return true;
}
