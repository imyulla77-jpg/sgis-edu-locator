// [화면] 엑셀 만들기 — 6개 시트 (DESIGN.md 8장, PLAN 작업 20)
// 시트: 안내 · 공통항목_요약 · 초등 · 중학 · 고교 · 수집 페이지 (PRD must 2: 6개로 고정)
// 사용자 브라우저 안에서 만든다(서버 시간을 쓰지 않도록). [엑셀 다운로드]를 누를 때 불러온다.
// 3과정 공통 항목은 공통ID 칸을 노란색으로 칠한다(작업 21).
// 수집 실패 페이지가 있으면 "안내" 시트 맨 위에 실패 목록을 적는다(작업 22).
// 다운로드 전 경고 문장·파일 이름·다운로드는 lib/download.ts(작업 22·23).
// 미리보기 그림이 주어지면 공통항목_요약 시트의 "미리보기" 칸에 넣는다(작업 26, 담당자 결정: 요약 시트에만, 긴 변 60픽셀).
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
  /** 메뉴를 골라 수집했으면 고른 상단 메뉴 (PLAN 작업 25). 전체 수집이면 없음 */
  menus?: string[];
  /** 그림 주소 → 미리보기 PNG (PLAN 작업 26). 없으면 미리보기 칸을 비워 둔다. null = 받지 못함 */
  thumbnails?: Map<string, ExcelThumbnail | null>;
}

/** 엑셀에 넣을 미리보기 그림 (lib/thumbnail.ts의 Thumbnail과 같은 모양) */
export interface ExcelThumbnail {
  bytes: ArrayBuffer;
  width: number;
  height: number;
}

/** 엑셀 파일 크기 한도 (PRD nice: 20MB). 여유를 두고 미리보기는 합계 18MB까지만 넣는다 */
const MAX_THUMBNAIL_BYTES = 18 * 1024 * 1024;

/** 요약 시트의 "미리보기" 칸 위치(0부터 세는 열 번호)와 미리보기가 있는 줄 높이(pt) */
const PREVIEW_COLUMN_INDEX = 3;
const PREVIEW_ROW_HEIGHT = 48;

/** 시트 이름 (순서대로) */
export const SHEET_NAMES = ['안내', '공통항목_요약', '초등', '중학', '고교', '수집 페이지'] as const;

const FONT = { name: '맑은 고딕', size: 10 };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
/** 3과정 공통 항목 표시 (PRD must 2: 노란색) */
const ALL3_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };

/** 3과정 모두에 있는 항목인지 */
const inAllCourses = (g: Group) => g.courses.length === COURSES.length;

/**
 * 3과정 공통 항목 줄의 공통ID 칸(첫 칸)을 노란색으로 칠한다.
 * rows는 시트에 넣은 순서 그대로의 묶음 목록(머리줄 다음 줄부터 한 줄씩 대응).
 */
function markAllCourses(ws: ExcelJS.Worksheet, groupOfRow: Group[]): void {
  groupOfRow.forEach((g, i) => {
    if (inAllCourses(g)) ws.getRow(i + 2).getCell(1).fill = ALL3_FILL;
  });
}

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

/** 바이트를 base64 글자로 바꾼다 (브라우저: btoa, Node: Buffer) */
function toBase64(bytes: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** 요약 시트에 넣을 미리보기를 정한다: 그림 묶음마다 1개, 합계 18MB까지. 넘치는 것은 생략 */
function planThumbnails(input: ExcelInput) {
  const embed = new Map<string, ExcelThumbnail>(); // 공통ID → 미리보기
  let total = 0;
  let skipped = 0;
  let missing = 0;
  if (!input.thumbnails) return { embed, skipped, missing, enabled: false };
  for (const g of input.groups) {
    if (g.kind !== '이미지' || !g.imageUrl) continue;
    const thumb = input.thumbnails.get(g.imageUrl);
    if (!thumb) {
      missing++;
      continue;
    }
    if (total + thumb.bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      skipped++;
      continue;
    }
    total += thumb.bytes.byteLength;
    embed.set(g.id, thumb);
  }
  return { embed, skipped, missing, enabled: true };
}

/** 안내 시트 */
function addGuide(wb: ExcelJS.Workbook, input: ExcelInput, preview: ReturnType<typeof planThumbnails>): void {
  const { groups, results } = input;
  const by = (n: number) => groups.filter((g) => g.courses.length === n).length;
  const ws = wb.addWorksheet('안내');
  ws.columns = [{ width: 22 }, { width: 100 }];
  const lines: [string, string][] = [
    ['조사 일시', input.collectedAt.toLocaleString('ko-KR')],
    ['대상 주소', input.startUrl],
    [
      '조사 범위',
      input.menus
        ? `일부 메뉴만 수집: ${input.menus.join(' · ')} (초등·중학·고교, ${input.totalPages}페이지). 다른 메뉴의 위치는 이 파일에 없습니다. 게시판 글은 수집하지 않았습니다.`
        : `초등·중학·고교 메인과, 3과정 모두에 있는 상단 메뉴의 하위 메뉴 전부 (${input.totalPages}페이지). 게시판 글은 수집하지 않았습니다.`,
    ],
    ['수집 결과', `성공 ${results.filter((r) => r.status === '성공').length} · 실패 ${results.filter((r) => r.status !== '성공').length} / 전체 ${input.totalPages}페이지`],
    ['항목 수', `공통ID ${groups.length}개 — 3과정 공통 ${by(3)} · 2과정 공통 ${by(2)} · 한 과정만 ${by(1)}`],
    ['"같은 항목" 기준', '이미지: 파일 내용이 완전히 같으면 같은 그림으로 봅니다(파일 이름·경로가 달라도).\n문구: 띄어쓰기·줄바꿈을 정리한 뒤 글자가 완전히 같으면 같은 문구로 봅니다.'],
    ['공통ID', '같은 그림·문구는 모든 시트에서 같은 공통ID(IMG-xxx / TXT-xxx)를 씁니다. 한 곳을 고치면 같은 ID의 다른 위치도 함께 고쳐야 합니다. 필터로 ID를 걸러 보세요.\n공통ID 칸이 노란색이면 초등·중학·고교 3과정 모두에 있는 항목입니다.'],
    ['위치', '메뉴 · 페이지 주소 · 영역(상단/본문/하단) 3가지로 적었습니다. "숨김"은 탭·펼침 메뉴를 눌러야 보이는 항목입니다.'],
    ['시트 구성', '공통항목_요약: 공통ID 1개당 1줄, 과정별 위치 수 / 초등·중학·고교: 위치 1개당 1줄 / 수집 페이지: 수집한 페이지 목록'],
    ['비고 표시', '비교 불가: 그림 파일을 받지 못해 내용을 비교하지 못한 그림(주소가 같을 때만 같은 항목)\n이용자 등록 콘텐츠: 이용자가 올린 그림(현행화 대상과 구분)'],
    [
      '미리보기',
      preview.enabled
        ? `공통항목_요약 시트의 "미리보기" 칸에 그림을 작게(긴 변 60픽셀) 넣었습니다(${preview.embed.size}개). 움직이는 그림은 첫 장면만 보입니다.` +
          (preview.missing > 0 ? `\n받지 못한 그림 ${preview.missing}개는 "미리보기 없음"으로 적었습니다.` : '') +
          (preview.skipped > 0 ? `\n파일 크기 한도(20MB) 때문에 ${preview.skipped}개는 넣지 않았습니다.` : '')
        : '이 파일에는 그림 미리보기가 없습니다. 그림은 "이미지 주소"를 눌러 보세요.',
    ],
    ['주의', '크기나 색만 다른 같은 그림은 다른 그림으로 처리됩니다. 따로 확인하세요.\n이 파일은 내부용입니다. 인터넷에 공개하지 마세요.'],
  ];
  ws.addRow(['SGIS에듀 3과정 이미지·문구 위치']);
  ws.addRow([]);

  // 수집 실패 목록: 엑셀만 받은 작업자도 빠진 페이지를 알 수 있도록 맨 위에 빨간 글씨로 적는다 (PRD must 2)
  const failed = results.filter((r) => r.status !== '성공');
  const redRows = new Set<number>();
  if (failed.length > 0) {
    redRows.add(ws.addRow([`⚠ 수집 실패 ${failed.length}개`, '아래 페이지는 수집하지 못해 이 파일에 위치가 빠져 있습니다. 직접 확인하세요.']).number);
    for (const r of failed) {
      redRows.add(ws.addRow([`${r.target.course} ${r.target.menu}`, `${r.target.url}  —  ${r.error ?? r.status}`]).number);
    }
    ws.addRow([]);
  }

  for (const line of lines) ws.addRow(line);
  ws.eachRow((row, n) =>
    row.eachCell((cell, colNumber) => {
      cell.font =
        n === 1
          ? { ...FONT, size: 14, bold: true }
          : { ...FONT, bold: colNumber === 1, ...(redRows.has(n) ? { color: { argb: 'FFC00000' } } : {}) };
      cell.alignment = { vertical: 'top', wrapText: true };
    }),
  );
}

/** 공통항목_요약 시트: 공통ID 1개당 1줄, 과정별 위치 수는 "N곳" (Q-a 나) */
function summaryRows(groups: Group[], preview: ReturnType<typeof planThumbnails>) {
  return groups.map((g) => {
    const count = (c: Course) => g.locations.filter((l) => l.course === c).length;
    const cell = (c: Course) => (count(c) > 0 ? `${count(c)}곳` : '');
    // 미리보기 칸: 그림은 나중에 칸 위에 얹는다. 받지 못한 그림은 글자로 알린다
    const previewText = preview.enabled && g.kind === '이미지' && !preview.embed.has(g.id) ? '미리보기 없음' : '';
    return {
      id: g.id,
      kind: g.kind,
      content: g.display,
      preview: previewText,
      image: g.kind === '이미지' ? link(g.imageUrl) : '',
      courses: coursesLabel(g),
      ele: cell('초등'),
      mid: cell('중학'),
      high: cell('고교'),
    };
  });
}

/** 과정별 시트: 위치 1개당 1줄 (공통ID 순서 → 위치 순서). 줄마다 어느 묶음인지도 함께 돌려준다 */
function courseRows(groups: Group[], course: Course) {
  const rows: Record<string, unknown>[] = [];
  const groupOfRow: Group[] = [];
  for (const g of groups) {
    for (const l of g.locations.filter((loc: Location) => loc.course === course)) {
      groupOfRow.push(g);
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
  return { rows, groupOfRow };
}

/** 6개 시트 엑셀 파일을 만들어 그 내용(바이트)을 돌려준다 */
export async function buildWorkbook(input: ExcelInput): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SGIS에듀 현행화 위치찾기';
  wb.created = input.collectedAt;

  const preview = planThumbnails(input);
  addGuide(wb, input, preview);

  const summarySheet = addTable(
    wb,
    '공통항목_요약',
    [
      { header: '공통ID', key: 'id', width: 10 },
      { header: '구분', key: 'kind', width: 7 },
      { header: '내용(문구 / 이미지 파일 이름)', key: 'content', width: 44 },
      { header: '미리보기', key: 'preview', width: 11 },
      { header: '이미지 주소', key: 'image', width: 44 },
      { header: '있는 과정', key: 'courses', width: 14 },
      { header: '초등 위치 수', key: 'ele', width: 11 },
      { header: '중학 위치 수', key: 'mid', width: 11 },
      { header: '고교 위치 수', key: 'high', width: 11 },
    ],
    summaryRows(input.groups, preview),
  );
  markAllCourses(summarySheet, input.groups);

  // 미리보기 그림을 "미리보기" 칸 위에 얹는다(공통ID 1개당 그림 1개)
  input.groups.forEach((g, i) => {
    const thumb = preview.embed.get(g.id);
    if (!thumb) return;
    const rowNumber = i + 2; // 머리줄 다음부터
    summarySheet.getRow(rowNumber).height = PREVIEW_ROW_HEIGHT;
    // 브라우저·Node 모두에서 되도록 base64 글자로 넘긴다
    const imageId = wb.addImage({ base64: `data:image/png;base64,${toBase64(thumb.bytes)}`, extension: 'png' });
    summarySheet.addImage(imageId, {
      tl: { col: PREVIEW_COLUMN_INDEX + 0.1, row: rowNumber - 1 + 0.1 },
      ext: { width: thumb.width, height: thumb.height },
      editAs: 'oneCell',
    });
  });

  for (const course of COURSES) {
    const { rows, groupOfRow } = courseRows(input.groups, course);
    const courseSheet = addTable(
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
      rows,
    );
    markAllCourses(courseSheet, groupOfRow);
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
