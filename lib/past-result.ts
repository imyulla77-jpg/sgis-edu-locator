// [화면] 지난 수집 결과 엑셀 읽기 (PRD nice 1, PLAN 작업 27, DESIGN.md 17장)
// 이 앱이 만든 엑셀의 "공통항목_요약" 시트와 "안내" 시트를 읽는다.
// 엑셀 도구(exceljs)를 쓰므로 화면에서는 [지난 결과 엑셀 올리기]를 누를 때 불러온다.
//
// scripts/에서도 불러올 수 있도록 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import ExcelJS from 'exceljs';
import { fallbackKey, type PastItem, type PastResult } from './compare.ts';
import type { ItemKind } from './types.ts';

/** 지난 결과 엑셀로 읽을 수 없을 때 보여 줄 안내 */
export const NOT_PAST_RESULT_MESSAGE = '이 앱이 만든 엑셀이 아니에요. "SGIS에듀_공통위치_날짜.xlsx" 파일을 올려 주세요.';

/** 칸 값을 글자로 (링크 칸은 글자 부분) */
function text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text);
  if (typeof value === 'object' && 'richText' in value) return value.richText.map((r) => r.text).join('');
  return String(value);
}

/** 지난 결과 엑셀(바이트)을 읽는다. 이 앱이 만든 엑셀이 아니면 Error(NOT_PAST_RESULT_MESSAGE) */
export async function readPastResult(bytes: ArrayBuffer, fileName: string): Promise<PastResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    throw new Error(NOT_PAST_RESULT_MESSAGE);
  }
  const summary = wb.getWorksheet('공통항목_요약');
  const guide = wb.getWorksheet('안내');
  if (!summary || !guide) throw new Error(NOT_PAST_RESULT_MESSAGE);

  // 머리줄 이름으로 열을 찾는다(열 순서가 바뀌어도 읽을 수 있도록)
  const col: Record<string, number> = {};
  summary.getRow(1).eachCell((cell, n) => (col[text(cell.value)] = n));
  const kindCol = col['구분'];
  const contentCol = Object.entries(col).find(([name]) => name.startsWith('내용'))?.[1];
  if (!kindCol || !contentCol) throw new Error(NOT_PAST_RESULT_MESSAGE);
  const keyCol = col['비교 기준'];
  const imageCol = col['이미지 주소'];
  const coursesCol = col['있는 과정'];

  const items: PastItem[] = [];
  summary.eachRow((row, n) => {
    if (n === 1) return;
    const kind = text(row.getCell(kindCol).value) as ItemKind;
    if (kind !== '이미지' && kind !== '문구') return;
    const display = text(row.getCell(contentCol).value);
    const imageUrl = imageCol ? text(row.getCell(imageCol).value) || undefined : undefined;
    items.push({
      key: (keyCol && text(row.getCell(keyCol).value)) || fallbackKey(kind, display, imageUrl),
      kind,
      display,
      imageUrl,
      courses: coursesCol ? text(row.getCell(coursesCol).value) : '',
    });
  });

  // 안내 시트에서 조사 일시·조사 범위
  let collectedAt = '';
  let scope = '';
  guide.eachRow((row) => {
    const label = text(row.getCell(1).value);
    if (label === '조사 일시') collectedAt = text(row.getCell(2).value);
    if (label === '조사 범위') scope = text(row.getCell(2).value);
  });

  return { fileName, collectedAt, scope, hasKeys: Boolean(keyCol), items };
}
