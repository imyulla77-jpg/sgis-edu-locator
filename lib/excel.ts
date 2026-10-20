// 엑셀 만들기 — 5개 시트 (DESIGN.md 9장, PRD must 2, PLAN 작업 18~21)
//   1. 현행화_기록: 요구사항 3~4 결과 (그림 행·문장 행, 찾은 순서대로)
//   2. 현행화_정렬: 시트 1 전체를 같은 그림·문장끼리 정렬하고 그룹ID를 단 것
//   3. 검토할 이미지: 유일한 그림 하나를 한 행으로 합친 것 (요구사항 7)
//   4. 검토할 텍스트: 유일한 문장 하나를 한 행으로 합친 것 (요구사항 7)
//   5. 수집_기록: 기준·페이지 목록·확인 필요·홈페이지 경로 없음·대상 아님·연도 없음 그림 목록
// 캡처 그림은 같은 그림을 한 번만 파일에 넣고 여러 행에서 다시 쓴다(파일 크기를 줄이기 위해).
// 3과정 모두에 나오는 그룹은 노란색으로 표시한다. "수정 후 내용" 칸은 없다(2026-10-20 요구사항 수정).
// 화면(브라우저)과 개발용 실행(Node)에서 모두 돌아간다.
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import ExcelJS from 'exceljs';
import { groupRecords, sortedForSheet2, type RecordGroup } from './group.ts';
import { fileNameOf } from './records.ts';
import type { HomeLink, Judgement, PageResult, RecordRow, TargetList } from './refresh-types.ts';
import { COURSES, TARGET_MAX_YEAR } from './refresh-types.ts';

/** 엑셀을 만드는 데 필요한 것 (lib/run-steps.ts의 RunOutcome과 같은 모양) */
export interface ExcelInput {
  startUrl: string;
  finishedAt: Date;
  targets: TargetList;
  results: PageResult[];
  judgements: Map<string, Judgement>;
  records: RecordRow[];
}

export const SHEET_NAMES = ['현행화_기록', '현행화_정렬', '검토할 이미지', '검토할 텍스트', '수집_기록'] as const;

/** 캡처를 엑셀 칸에 보여 줄 최대 크기(픽셀) */
const CAPTURE_MAX = { width: 300, height: 160 };
/** 캡처 열 너비(글자 수 단위, 약 7픽셀) */
const CAPTURE_COL_WIDTH = 44;

const FONT = { name: '맑은 고딕', size: 10 };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } };
const ALL3_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const SECTION_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

const link = (url?: string | null) => (url ? { text: url, hyperlink: url } : '');
const homePath = (h?: HomeLink | null) => (h && h.menu ? `${h.menu} > ${h.sub}` : '');

/** JPEG 그림의 가로·세로 픽셀을 파일 머리 부분에서 읽는다. 읽지 못하면 null */
export function jpegSize(base64: string): { width: number; height: number } | null {
  const bin = typeof atob === 'function' ? atob(base64.slice(0, 80_000)) : Buffer.from(base64.slice(0, 80_000), 'base64').toString('latin1');
  let i = 2;
  while (i + 9 < bin.length) {
    if (bin.charCodeAt(i) !== 0xff) return null;
    const marker = bin.charCodeAt(i + 1);
    const length = (bin.charCodeAt(i + 2) << 8) + bin.charCodeAt(i + 3);
    // SOF0~SOF15 (DHT·JPG·DAC 제외)에 크기가 있다
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bin.charCodeAt(i + 5) << 8) + bin.charCodeAt(i + 6), width: (bin.charCodeAt(i + 7) << 8) + bin.charCodeAt(i + 8) };
    }
    i += 2 + length;
  }
  return null;
}

/** 캡처 그림을 한 번만 넣고 다시 쓰기 위한 도우미 */
class CaptureStore {
  private ids = new Map<string, { id: number; width: number; height: number } | null>();
  private wb: ExcelJS.Workbook;
  constructor(wb: ExcelJS.Workbook) {
    this.wb = wb;
  }
  get(base64: string | null): { id: number; width: number; height: number } | null {
    if (!base64) return null;
    if (!this.ids.has(base64)) {
      const size = jpegSize(base64);
      if (!size) {
        this.ids.set(base64, null);
      } else {
        const scale = Math.min(1, CAPTURE_MAX.width / size.width, CAPTURE_MAX.height / size.height);
        const id = this.wb.addImage({ base64: `data:image/jpeg;base64,${base64}`, extension: 'jpeg' });
        this.ids.set(base64, { id, width: Math.round(size.width * scale), height: Math.round(size.height * scale) });
      }
    }
    return this.ids.get(base64) ?? null;
  }
}

interface Column {
  header: string;
  width: number;
}

/** 머리글 행·열 너비·틀 고정·필터를 갖춘 시트를 만든다 */
function addTableSheet(wb: ExcelJS.Workbook, name: string, columns: Column[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
  const header = ws.getRow(1);
  header.eachCell((cell) => {
    cell.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  header.height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

/** 행 모양을 정하고(글꼴·줄바꿈·링크 색), 캡처가 있으면 그 칸에 그림을 놓는다 */
function styleRow(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  capture: { id: number; width: number; height: number } | null,
  captureCol: number,
  fill?: ExcelJS.Fill,
) {
  const row = ws.getRow(rowNumber);
  row.eachCell({ includeEmpty: true }, (cell) => {
    const isLink = typeof cell.value === 'object' && cell.value !== null && 'hyperlink' in cell.value;
    cell.font = isLink ? { ...FONT, color: { argb: 'FF0563C1' }, underline: true } : FONT;
    cell.alignment = { vertical: 'top', wrapText: true };
    if (fill) cell.fill = fill;
  });
  // 행 높이 = 캡처 높이와 글자가 줄바꿈되어 차지하는 높이 중 큰 쪽 (글자가 잘려 보이지 않게)
  const captureHeight = capture ? capture.height * 0.75 + 8 : 0; // 픽셀 → 포인트(약 0.75배) + 여백
  row.height = Math.min(MAX_ROW_HEIGHT, Math.max(20, captureHeight, textHeight(ws, row)));
  if (capture) {
    ws.addImage(capture.id, { tl: { col: captureCol - 1 + 0.05, row: rowNumber - 1 + 0.05 }, ext: { width: capture.width, height: capture.height } });
  }
}

/** 엑셀 행 높이 한도(포인트) */
const MAX_ROW_HEIGHT = 409;
/** 글자 한 줄 높이(포인트, 10pt 글꼴) */
const LINE_HEIGHT = 13.5;

/** 칸 너비(글자 수 단위) 안에서 글자가 몇 줄로 줄바꿈되는지 어림한다. 한글·한자는 영문의 약 1.8배 너비 */
function wrappedLines(text: string, columnWidth: number): number {
  return text.split('\n').reduce((sum, line) => {
    let units = 0;
    for (const ch of line) units += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 1.8 : 1;
    return sum + Math.max(1, Math.ceil(units / Math.max(1, columnWidth - 1)));
  }, 0);
}

/** 행에서 글자가 가장 많이 줄바꿈되는 칸의 높이(포인트) */
function textHeight(ws: ExcelJS.Worksheet, row: ExcelJS.Row): number {
  let lines = 1;
  row.eachCell((cell, col) => {
    const v = cell.value;
    const text = typeof v === 'string' ? v : typeof v === 'object' && v !== null && 'text' in v ? String(v.text) : v == null ? '' : String(v);
    lines = Math.max(lines, wrappedLines(text, ws.getColumn(col).width ?? 10));
  });
  return lines * LINE_HEIGHT + 6;
}

/** 시트 1·2 공통 열 (시트 2는 앞에 그룹ID가 붙는다) */
const RECORD_COLUMNS: Column[] = [
  { header: '순번', width: 7 },
  { header: '구분', width: 6 },
  { header: '캡처', width: CAPTURE_COL_WIDTH },
  { header: '과정', width: 6 },
  { header: '2단계', width: 10 },
  { header: '3단계', width: 18 },
  { header: '상세 페이지 제목', width: 24 },
  { header: '페이지 주소', width: 30 },
  { header: '소제목', width: 24 },
  { header: '그림 번호', width: 8 },
  { header: '그림 파일 주소', width: 30 },
  { header: '최고 연도', width: 8 },
  { header: '판정', width: 10 },
  { header: '홈페이지 경로', width: 22 },
  { header: '홈페이지 주소', width: 30 },
  { header: '텍스트 내용', width: 40 },
  { header: '관련 그림', width: 18 },
  { header: '비고', width: 30 },
];

function recordValues(r: RecordRow): (string | number | { text: string; hyperlink: string })[] {
  return [
    r.no,
    r.kind,
    r.capture ? '' : '캡처 없음',
    r.location.course,
    r.location.level2,
    r.location.level3,
    r.pageTitle,
    link(r.location.url),
    r.section,
    r.imageIndex ? `${r.imageIndex}번째` : '',
    link(r.src),
    r.maxYear ?? '',
    r.verdict ?? '',
    homePath(r.homeLink),
    link(r.homeLink?.url),
    r.before ?? '',
    (r.relatedImages ?? []).join(', '),
    r.note,
  ];
}

/** 시트 1: 현행화_기록 */
function addRecordSheet(wb: ExcelJS.Workbook, store: CaptureStore, records: RecordRow[], all3: Set<number>) {
  const ws = addTableSheet(wb, SHEET_NAMES[0], RECORD_COLUMNS);
  records.forEach((r, i) => {
    ws.addRow(recordValues(r));
    styleRow(ws, i + 2, store.get(r.capture), 3, all3.has(r.no) ? ALL3_FILL : undefined);
  });
}

/** 시트 2: 현행화_정렬 (그룹 경계에 굵은 위쪽 테두리) */
function addSortedSheet(wb: ExcelJS.Workbook, store: CaptureStore, groups: RecordGroup[]) {
  const ws = addTableSheet(wb, SHEET_NAMES[1], [{ header: '그룹ID', width: 9 }, ...RECORD_COLUMNS]);
  let previous = '';
  sortedForSheet2(groups).forEach(({ group, row }, i) => {
    ws.addRow([group.id, ...recordValues(row)]);
    styleRow(ws, i + 2, store.get(row.capture), 4, group.courses.length === COURSES.length ? ALL3_FILL : undefined);
    if (group.id !== previous && i > 0) {
      ws.getRow(i + 2).eachCell({ includeEmpty: true }, (cell) => (cell.border = { top: { style: 'medium' } }));
    }
    previous = group.id;
  });
}

/** 그룹 행들에서 빈 값을 빼고 겹치지 않게 모은다 */
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/** 시트 3·4 공통: 나온 곳 수 · 나온 과정 · 위치 목록 · 페이지 주소 목록 · 비고 */
function mergedTail(g: RecordGroup): (string | number)[] {
  const locations = g.rows.map(
    (r) => `${r.location.course} > ${r.location.level2} > ${r.location.level3} > ${r.pageTitle} · ${r.section}${r.imageIndex ? ` ${r.imageIndex}번째` : ''}`,
  );
  return [
    g.rows.length,
    g.courses.join('·'),
    locations.join('\n'),
    unique(g.rows.map((r) => r.location.url)).join('\n'),
    unique(g.rows.map((r) => r.note)).join('\n'),
  ];
}

const MERGED_TAIL_COLUMNS: Column[] = [
  { header: '나온 곳 수', width: 8 },
  { header: '나온 과정', width: 14 },
  { header: '위치 목록', width: 50 },
  { header: '페이지 주소 목록', width: 50 },
  { header: '비고', width: 30 },
];

/** 시트 3: 검토할 이미지 (그림 그룹 1개 = 1행, 요구사항 7) */
function addReviewImageSheet(wb: ExcelJS.Workbook, store: CaptureStore, groups: RecordGroup[]) {
  const ws = addTableSheet(wb, SHEET_NAMES[2], [
    { header: '그룹ID', width: 9 },
    { header: '캡처 이미지', width: CAPTURE_COL_WIDTH },
    { header: '파일명', width: 18 },
    { header: '최고 연도', width: 8 },
    { header: '판정', width: 10 },
    { header: '홈페이지 경로', width: 22 },
    { header: '홈페이지 주소', width: 30 },
    ...MERGED_TAIL_COLUMNS,
  ]);
  groups
    .filter((g) => g.kind === '그림')
    .forEach((g, i) => {
      const first = g.rows[0];
      ws.addRow([
        g.id,
        first.capture ? '' : '캡처 없음',
        unique(g.rows.map((r) => (r.src ? fileNameOf(r.src) : ''))).join('\n'),
        first.maxYear ?? '',
        first.verdict ?? '',
        unique(g.rows.map((r) => homePath(r.homeLink))).join('\n'),
        unique(g.rows.map((r) => r.homeLink?.url ?? '')).join('\n'),
        ...mergedTail(g),
      ]);
      styleRow(ws, i + 2, store.get(first.capture), 2, g.courses.length === COURSES.length ? ALL3_FILL : undefined);
    });
}

/** 시트 4: 검토할 텍스트 (문장 그룹 1개 = 1행, 요구사항 7) */
function addReviewTextSheet(wb: ExcelJS.Workbook, store: CaptureStore, groups: RecordGroup[]) {
  const ws = addTableSheet(wb, SHEET_NAMES[3], [
    { header: '그룹ID', width: 9 },
    { header: '캡처 이미지', width: CAPTURE_COL_WIDTH },
    { header: '캡처 내용(텍스트)', width: 40 },
    ...MERGED_TAIL_COLUMNS,
  ]);
  groups
    .filter((g) => g.kind === '문장')
    .forEach((g, i) => {
      const first = g.rows[0];
      ws.addRow([g.id, first.capture ? '' : '캡처 없음', first.before ?? '', ...mergedTail(g)]);
      styleRow(ws, i + 2, store.get(first.capture), 2, g.courses.length === COURSES.length ? ALL3_FILL : undefined);
    });
}

/** 시트 5: 수집_기록 (구역마다 제목 줄 + 표) */
function addLogSheet(wb: ExcelJS.Workbook, input: ExcelInput, groups: RecordGroup[]) {
  const ws = wb.addWorksheet(SHEET_NAMES[4]);
  ws.columns = [{ width: 28 }, { width: 50 }, { width: 14 }, { width: 14 }, { width: 50 }];
  const js = [...input.judgements.values()];
  const count = (v: string) => js.filter((j) => j.verdict === v).length;
  const models = [...new Set(js.map((j) => j.model).filter(Boolean))].join(', ') || '없음';

  const section = (title: string) => {
    ws.addRow([]);
    const row = ws.addRow([title]);
    row.getCell(1).font = { ...FONT, bold: true, size: 11 };
    for (let c = 1; c <= 5; c++) row.getCell(c).fill = SECTION_FILL;
  };
  const table = (header: string[], rows: (string | number | { text: string; hyperlink: string })[][]) => {
    const h = ws.addRow(header);
    h.eachCell((cell) => (cell.font = { ...FONT, bold: true }));
    if (rows.length === 0) ws.addRow(['없음']);
    for (const r of rows) {
      const row = ws.addRow(r);
      row.eachCell((cell) => {
        const isLink = typeof cell.value === 'object' && cell.value !== null && 'hyperlink' in cell.value;
        cell.font = isLink ? { ...FONT, color: { argb: 'FF0563C1' }, underline: true } : FONT;
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    }
  };

  const title = ws.addRow(['SGIS에듀 현행화 대상 찾기 — 수집 기록']);
  title.getCell(1).font = { ...FONT, bold: true, size: 14 };

  section('기준');
  table(
    ['항목', '내용'],
    [
      ['검색 날짜', input.finishedAt.toLocaleString('ko-KR')],
      ['시작 주소', link(input.startUrl)],
      ['판정 기준', `그림 속 최고 연도가 ${TARGET_MAX_YEAR}년 이하이면 현행화 대상 (2027년 이상·연도 없음은 대상 아님)`],
      ['연도를 읽은 AI 모델', models],
      ['검색한 페이지', `${input.results.length}개 (실패 ${input.results.filter((r) => r.status !== '성공').length}개)`],
      ['본문 그림', `${js.length}개 — 현행화 대상 ${count('현행화 대상')} · 대상 아님 ${count('대상 아님')} · 연도 없음 ${count('연도 없음')} · 확인 필요 ${count('확인 필요')}`],
      ['시트 1 행', `${input.records.length}행 (그룹 ${groups.length}개: 그림 ${groups.filter((g) => g.kind === '그림').length} · 문장 ${groups.filter((g) => g.kind === '문장').length})`],
      ['검토 시트', '검토할 이미지·검토할 텍스트 시트는 같은 그림·문장을 한 줄로 합친 것이에요. 그룹ID로 현행화_정렬 시트의 행을 찾을 수 있어요.'],
      ['노란색 행', '초등·중학·고교 3과정 모두에 나오는 그림·문장'],
    ],
  );

  if (input.targets.warnings.length > 0) {
    section(`메뉴 경고 (${input.targets.warnings.length})`);
    table(['내용'], input.targets.warnings.map((w) => [w]));
  }

  const failed = input.results.filter((r) => r.status !== '성공');
  section(`수집하지 못한 페이지 (${failed.length})`);
  table(['상세 페이지 제목', '주소', '상태', '걸린 시간(초)', '이유'], failed.map((r) => [r.target.title ?? '', link(r.target.openUrl), r.status, r.seconds, r.error ?? '']));

  const byVerdict = (v: string) => js.filter((j) => j.verdict === v);
  section(`확인 필요 그림 (${count('확인 필요')}) — 사람이 직접 보고 판단해 주세요`);
  table(['그림 파일', '그림 주소', '읽은 연도', '', '이유'], byVerdict('확인 필요').map((j) => [fileNameOf(j.src), link(j.src), j.years.join('·'), '', j.error ?? '']));

  const noPath = groups
    .filter((g) => g.kind === '그림' && g.rows.every((r) => !r.homeLink))
    .map((g) => g.rows[0]);
  section(`홈페이지 경로 없음 그림 (${noPath.length}) — 바로가기 버튼이 없거나 짝을 정할 수 없음`);
  table(['그림 파일', '그림 주소', '최고 연도', '판정', '이유'], noPath.map((r) => [fileNameOf(r.src ?? ''), link(r.src), r.maxYear ?? '', r.verdict ?? '', r.note]));

  section(`대상 아님 그림 (${count('대상 아님')}) — 최고 연도가 ${TARGET_MAX_YEAR + 1}년 이상 (담당자 결정: 문구대로 대상 아님)`);
  table(['그림 파일', '그림 주소', '읽은 연도', '최고 연도', ''], byVerdict('대상 아님').map((j) => [fileNameOf(j.src), link(j.src), j.years.join('·'), j.maxYear ?? '', '']));

  section(`연도 없음 그림 (${count('연도 없음')}) — 그림에 연도가 적혀 있지 않음 (담당자 결정: 대상 아님)`);
  table(['그림 파일', '그림 주소', '', '', ''], byVerdict('연도 없음').map((j) => [fileNameOf(j.src), link(j.src), '', '', '']));

  section(`검색한 페이지 (${input.results.length})`);
  table(
    ['상세 페이지 제목', '주소', '상태', '그림 수', '나오는 메뉴 위치'],
    input.results.map((r) => [
      r.target.title ?? '',
      link(r.target.openUrl),
      r.status,
      r.images.length,
      r.target.locations.map((l) => `${l.course} > ${l.level2} > ${l.level3}`).join('\n'),
    ]),
  );
}

/** 5개 시트 엑셀을 만들어 파일 내용을 돌려준다 */
export async function buildWorkbook(input: ExcelInput): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SGIS에듀 현행화 대상 찾기';
  wb.created = input.finishedAt;
  const store = new CaptureStore(wb);
  const groups = groupRecords(input.records);
  const all3 = new Set(groups.filter((g) => g.courses.length === COURSES.length).flatMap((g) => g.rows.map((r) => r.no)));

  addRecordSheet(wb, store, input.records, all3);
  addSortedSheet(wb, store, groups);
  addReviewImageSheet(wb, store, groups);
  addReviewTextSheet(wb, store, groups);
  addLogSheet(wb, input, groups);
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
