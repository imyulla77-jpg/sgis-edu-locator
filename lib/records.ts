// 시트 1(현행화_기록) 행 만들기 — 수집 결과 + AI 판단 → 행 목록 (DESIGN.md 5·9장, PLAN 작업 18)
// 브라우저 없이 계산만 하므로 화면과 개발용 실행(scripts/)이 함께 쓴다.
// - 그림 행: 판정이 "현행화 대상" 또는 "확인 필요"인 그림
// - 문장 행: 같은 소제목 영역에 "현행화 대상"·"확인 필요" 그림이 있는 연도 문장(수집 때 2026년 이하 연도로 이미 걸러짐)
// - 행 = 항목 × 메뉴 위치 1곳. 순서는 찾은 순서(페이지 → 위치 → 영역 → 그림 → 그 영역의 문장)
// - 수정 후 내용은 만들지 않는다(담당자가 엑셀에서 채움)
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import { resolveHomeLink } from './home-link.ts';
import type { HomeMenuItem, Judgement, PageResult, RecordRow } from './refresh-types.ts';

/** 시트 1에 올리는 그림 판정 */
const RECORDED_VERDICTS = new Set(['현행화 대상', '확인 필요']);

/** 그림 주소의 파일 이름. 예: …/E0101_01.png → E0101_01.png */
export function fileNameOf(src: string): string {
  return src.split('/').pop()?.split('?')[0] ?? src;
}

/** 수집 결과와 그림별 AI 판단(주소 → 판단)으로 시트 1 행을 만든다 */
export function buildRecords(results: PageResult[], judgements: Map<string, Judgement>, homeMenus: HomeMenuItem[]): RecordRow[] {
  const rows: Omit<RecordRow, 'no'>[] = [];
  for (const page of results) {
    if (page.status !== '성공') continue;
    // 영역 순서대로: 그 영역의 대상 그림 → 그 영역의 문장
    const sections = [...new Set([...page.images.map((i) => i.section), ...page.sentences.map((s) => s.section)])];
    const recordedSrcs = new Set(
      page.images.filter((i) => RECORDED_VERDICTS.has(judgements.get(i.src)?.verdict ?? '확인 필요')).map((i) => i.src),
    );

    for (const location of page.target.locations) {
      const common = { location, pageTitle: page.target.title ?? '', contentsId: page.target.contentsId };
      for (const section of sections) {
        for (const image of page.images.filter((i) => i.section === section && recordedSrcs.has(i.src))) {
          const j = judgements.get(image.src);
          const homeLink = image.button ? resolveHomeLink(image.button, homeMenus) : null;
          const notes = [
            j?.error ? `확인 필요: ${j.error}` : !j ? '확인 필요: AI 판단 결과 없음' : '',
            homeLink ? (homeLink.menu ? (homeLink.note ?? '') : `홈페이지 경로 없음: ${homeLink.note ?? ''}`) : `홈페이지 경로 없음: ${image.buttonNote ?? '바로가기 버튼 없음'}`,
          ].filter(Boolean);
          rows.push({
            ...common,
            kind: '그림',
            capture: image.capture,
            section,
            imageIndex: image.indexInSection,
            src: image.src,
            sha256: j?.sha256 ?? null,
            years: j?.years ?? [],
            maxYear: j?.maxYear ?? null,
            verdict: j?.verdict ?? '확인 필요',
            homeLink: homeLink && homeLink.menu ? homeLink : null,
            note: notes.join(' / '),
          });
        }
        for (const sentence of page.sentences.filter((s) => s.section === section)) {
          const related = sentence.relatedImageSrcs.filter((src) => recordedSrcs.has(src));
          if (related.length === 0) continue;
          const onlyUnsure = related.every((src) => judgements.get(src)?.verdict !== '현행화 대상');
          rows.push({
            ...common,
            kind: '문장',
            capture: sentence.capture,
            section,
            before: sentence.text,
            relatedImages: related.map(fileNameOf),
            note: [sentence.capture ? '' : '캡처 불가', onlyUnsure ? '관련 그림이 확인 필요라 함께 올림' : ''].filter(Boolean).join(' / '),
          });
        }
      }
    }
  }
  return rows.map((row, i) => ({ no: i + 1, ...row }) as RecordRow);
}
