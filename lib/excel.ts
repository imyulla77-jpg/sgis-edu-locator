// [화면] 엑셀 만들기 — 6개 시트 (DESIGN.md 8장, PLAN 작업 20)
// 시트: 안내 · 공통항목_요약 · 초등 · 중학 · 고교 · 수집 페이지 (PRD must 2: 6개로 고정)
// 사용자 브라우저 안에서 만든다(서버 시간을 쓰지 않도록). [엑셀 다운로드]를 누를 때 불러온다.
// 3과정 공통 노란색(작업 21), 실패 경고·실패 목록(작업 22), 파일 이름·다운로드(작업 23)는 다음 작업에서 더한다.
//
// scripts/에서도 불러올 수 있도록 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import ExcelJS from 'exceljs';
import type { Course, Group, Location, PageResult } from './types.ts';
import { COURSES } from './types.ts';

/** 엑셀에 넣을 재료 */
export interface ExcelInput {
  startUrl: string;
  /** 수집을 마친 시각 */
  collectedAt: Date;
  totalPages: number;
  results: PageResult[];
  groups: Group[];
}

/** 시트 이름 (순서대로) */
export const SHEET_NAMES = ['안내', '공통항목_요약', '초등', '중학', '고교', '수집 페이지'] as const;

const FONT = { name: '맑은 고딕', size: 10 };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

/** 이용자가 직접 올린 그림인지 (그림 주소에 /upload/ 가 들어 있음 — 함께하기의 이용자 지도 썸네일 등) */
export function isUserUploaded(group: Group): boolean {
  return group.kind === '이미지' && /\/upload\//i.test(group.imageUrl ?? '');
}

const coursesLabel = (g: Group) => g.courses.join('·');
const link = (url?: string) => (url ? { text: url, hyperlink: url } : '');

/** 시트 하나를 만든다: 머리줄 꾸미기, 첫 줄 고정, 필터 켜기, 글꼴 */
function addTable(
  wb: ExcelJS.Workbook,
  name: (typeof SHEET_NAMES)[number],
  columns: { header: string; key: string; width: number }[],
  rows: Record<string, unknown>[],
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns;
  ws.addRows(rows);
  ws.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const isLink = typeof cell.value === 'object' && cell.value !== null && 'hyperlink' in cell.value;
      cell.font = rowNumber === 1 ? { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } } : { ...FONT, ...(isLink ? { color: { argb: 'FF0563C1' }, underline: true } : {}) };
      if (rowNumber === 1) cell.fill = HEADER_FILL;
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

/** 안내 시트 */
function addGuide(wb: ExcelJS.Workbook, input: ExcelInput): void {
  const { groups, results } = input;
  const by = (n: number) => groups.filter((g) => g.courses.length === n).length;
  const ws = wb.addWorksheet('안내');
  ws.columns = [{ width: 22 }, { width: 100 }];
  const lines: [string, string][] = [
    ['조사 일시', input.collectedAt.toLocaleString('ko-KR')],
    ['대상 주소', input.startUrl],
    ['조사 범위', `초등·중학·고교 메인과, 3과정 모두에 있는 상단 메뉴의 하위 메뉴 전부 (${input.totalPages}페이지). 게시판 글은 수집하지 않았습니다.`],
    ['수집 결과', `성공 ${results.filter((r) => r.status === '성공').length} · 실패 ${results.filter((r) => r.status !== '성공').length} / 전체 ${input.totalPages}페이지`],
    ['항목 수', `공통ID ${groups.length}개 — 3과정 공통 ${by(3)} · 2과정 공통 ${by(2)} · 한 과정만 ${by(1)}`],
    ['"같은 항목" 기준', '이미지: 파일 내용이 완전히 같으면 같은 그림으로 봅니다(파일 이름·경로가 달라도).\n문구: 띄어쓰기·줄바꿈을 정리한 뒤 글자가 완전히 같으면 같은 문구로 봅니다.'],
    ['공통ID', '같은 그림·문구는 모든 시트에서 같은 공통ID(IMG-xxx / TXT-xxx)를 씁니다. 한 곳을 고치면 같은 ID의 다른 위치도 함께 고쳐야 합니다. 필터로 ID를 걸러 보세요.'],
    ['위치', '메뉴 · 페이지 주소 · 영역(상단/본문/하단) 3가지로 적었습니다. "숨김"은 탭·펼침 메뉴를 눌러야 보이는 항목입니다.'],
    ['시트 구성', '공통항목_요약: 공통ID 1개당 1줄, 과정별 위치 수 / 초등·중학·고교: 위치 1개당 1줄 / 수집 페이지: 수집한 페이지 목록'],
    ['비고 표시', '비교 불가: 그림 파일을 받지 못해 내용을 비교하지 못한 그림(주소가 같을 때만 같은 항목)\n이용자 등록 콘텐츠: 이용자가 올린 그림(현행화 대상과 구분)'],
    ['주의', '크기나 색만 다른 같은 그림은 다른 그림으로 처리됩니다. 따로 확인하세요.\n이 파일은 내부용입니다. 인터넷에 공개하지 마세요.'],
  ];
  ws.addRow(['SGIS에듀 3과정 이미지·문구 위치']);
  ws.addRow([]);
  for (const line of lines) ws.addRow(line);
  ws.eachRow((row, n) =>
    row.eachCell((cell, colNumber) => {
      cell.font = n === 1 ? { ...FONT, size: 14, bold: true } : { ...FONT, bold: colNumber === 1 };
      cell.alignment = { vertical: 'top', wrapText: true };
    }),
  );
}

/** 공통항목_요약 시트: 공통ID 1개당 1줄, 과정별 위치 수는 "N곳" (Q-a 나) */
function summaryRows(groups: Group[]) {
  return groups.map((g) => {
    const count = (c: Course) => g.locations.filter((l) => l.course === c).length;
    const cell = (c: Course) => (count(c) > 0 ? `${count(c)}곳` : '');
    return {
      id: g.id,
      kind: g.kind,
      content: g.display,
      image: g.kind === '이미지' ? link(g.imageUrl) : '',
      courses: coursesLabel(g),
      ele: cell('초등'),
      mid: cell('중학'),
      high: cell('고교'),
    };
  });
}

/** 과정별 시트: 위치 1개당 1줄 (공통ID 순서 → 위치 순서) */
function courseRows(groups: Group[], course: Course) {
  const rows: Record<string, unknown>[] = [];
  for (const g of groups) {
    for (const l of g.locations.filter((loc: Location) => loc.course === course)) {
      const notes = [!g.comparable && '비교 불가', isUserUploaded(g) && '이용자 등록 콘텐츠'].filter(Boolean).join(' / ');
      rows.push({
        id: g.id,
        kind: g.kind,
        content: g.display,
        alt: g.alt ?? '',
        image: g.kind === '이미지' ? link(g.imageUrl) : '',
        courses: coursesLabel(g),
        menu: l.menu,
        url: link(l.url),
        region: l.region,
        hidden: l.hidden ? '숨김' : '',
        note: notes,
      });
    }
  }
  return rows;
}

/** 6개 시트 엑셀 파일을 만들어 그 내용(바이트)을 돌려준다 */
export async function buildWorkbook(input: ExcelInput): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SGIS에듀 현행화 위치찾기';
  wb.created = input.collectedAt;

  addGuide(wb, input);

  addTable(
    wb,
    '공통항목_요약',
    [
      { header: '공통ID', key: 'id', width: 10 },
      { header: '구분', key: 'kind', width: 7 },
      { header: '내용(문구 / 이미지 파일 이름)', key: 'content', width: 44 },
      { header: '이미지 주소', key: 'image', width: 44 },
      { header: '있는 과정', key: 'courses', width: 14 },
      { header: '초등 위치 수', key: 'ele', width: 11 },
      { header: '중학 위치 수', key: 'mid', width: 11 },
      { header: '고교 위치 수', key: 'high', width: 11 },
    ],
    summaryRows(input.groups),
  );

  for (const course of COURSES) {
    addTable(
      wb,
      course,
      [
        { header: '공통ID', key: 'id', width: 10 },
        { header: '구분', key: 'kind', width: 7 },
        { header: '내용(문구 / 이미지 파일 이름)', key: 'content', width: 40 },
        { header: '이미지 설명(대체텍스트)', key: 'alt', width: 20 },
        { header: '이미지 주소', key: 'image', width: 36 },
        { header: '있는 과정', key: 'courses', width: 14 },
        { header: '메뉴', key: 'menu', width: 28 },
        { header: '페이지 주소', key: 'url', width: 40 },
        { header: '영역', key: 'region', width: 7 },
        { header: '숨김 여부', key: 'hidden', width: 9 },
        { header: '비고', key: 'note', width: 20 },
      ],
      courseRows(input.groups, course),
    );
  }

  addTable(
    wb,
    '수집 페이지',
    [
      { header: '과정', key: 'course', width: 8 },
      { header: '메뉴', key: 'menu', width: 34 },
      { header: '주소', key: 'url', width: 60 },
      { header: '성공/실패', key: 'status', width: 10 },
      { header: '실패 이유', key: 'error', width: 30 },
      { header: '수집 항목 수', key: 'count', width: 12 },
    ],
    input.results.map((r) => ({
      course: r.target.course,
      menu: r.target.menu,
      url: link(r.target.url),
      status: r.status === '성공' ? '성공' : '실패',
      error: r.error ?? '',
      count: r.items.length,
    })),
  );

  return wb.xlsx.writeBuffer();
}
