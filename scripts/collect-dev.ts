// 개발용 전체 수집 — 화면 없이 58페이지를 실제로 수집해 dev-output/에 저장한다 (DESIGN.md 11·12장, PLAN 작업 13)
// 실행: npm run collect:dev            (기본 시작 주소)
//       npm run collect:dev -- <주소>   (다른 시작 주소)
//
// Node가 TypeScript 파일을 바로 실행하므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import { mkdirSync, writeFileSync } from 'node:fs';
import { collectBatch } from '../lib/collect.ts';
import { buildGroups } from '../lib/group.ts';
import { loadBatches, MenuError } from '../lib/menus.ts';
import { runBatches } from '../lib/run-batches.ts';
import { SITE_UNAVAILABLE_MESSAGE } from '../lib/site-check.ts';
import { COURSES } from '../lib/types.ts';
import { DEFAULT_START_URL } from '../lib/url.ts';

/** 결과를 저장하는 폴더 (내부용 수집 결과라 .gitignore에 등록) */
const OUTPUT_DIR = 'dev-output';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

async function main(): Promise<void> {
  const startUrl = process.argv[2] ?? DEFAULT_START_URL;
  const startedAt = new Date();
  const t0 = Date.now();
  console.log(`시작 주소: ${startUrl}`);

  // ① 메뉴 읽기 → 수집 묶음 목록
  const { batches, totalPages } = await loadBatches(startUrl, {
    onRetry: (url, attempt) => console.log(`  메뉴 다시 읽기 ${attempt}번째: ${url}`),
  });
  const perCourse = COURSES.map((c) => `${c} ${batches.filter((b) => b.course === c).reduce((s, b) => s + b.pages.length, 0)}`);
  console.log(`메뉴 읽기 완료: ${totalPages}페이지 · ${batches.length}묶음 (${perCourse.join(' · ')}) · ${seconds(Date.now() - t0)}`);

  // ② 묶음을 차례로 수집 (화면과 같은 지휘 순서)
  const t1 = Date.now();
  const { results, stoppedAsUnavailable } = await runBatches(batches, (batch) => collectBatch(batch), {
    onProgress: ({ donePages, totalPages: total, failedPages, current }) =>
      console.log(`  [${donePages}/${total}] 실패 ${failedPages} · ${current}`),
  });
  const collectMs = Date.now() - t1;

  // ③ 같은 항목 묶기·공통ID
  const groups = stoppedAsUnavailable ? [] : buildGroups(results);
  const totalMs = Date.now() - t0;

  // ④ 저장
  const count = (status: string) => results.filter((r) => r.status === status).length;
  const summary = {
    startUrl,
    startedAt: startedAt.toISOString(),
    totalSeconds: Math.round(totalMs / 1000),
    collectSeconds: Math.round(collectMs / 1000),
    stoppedAsUnavailable,
    pages: { total: totalPages, success: count('성공'), failed: count('수집 실패'), timedOut: count('시간 초과') },
    items: results.reduce((s, r) => s + r.items.length, 0),
    groups: {
      total: groups.length,
      images: groups.filter((g) => g.kind === '이미지').length,
      texts: groups.filter((g) => g.kind === '문구').length,
      in3Courses: groups.filter((g) => g.courses.length === 3).length,
      in2Courses: groups.filter((g) => g.courses.length === 2).length,
      in1Course: groups.filter((g) => g.courses.length === 1).length,
      notComparableImages: groups.filter((g) => g.kind === '이미지' && !g.comparable).length,
    },
    failedPages: results.filter((r) => r.status !== '성공').map((r) => ({ ...r.target, status: r.status, error: r.error })),
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = `${OUTPUT_DIR}/collect-${stamp()}.json`;
  writeFileSync(file, JSON.stringify({ summary, results, groups }, null, 2), 'utf8');

  // ⑤ 요약 출력
  console.log('');
  if (stoppedAsUnavailable) console.log(`⚠ ${SITE_UNAVAILABLE_MESSAGE} (처음 3페이지 연속 실패로 중단)`);
  console.log(`페이지: 성공 ${summary.pages.success} · 수집 실패 ${summary.pages.failed} · 시간 초과 ${summary.pages.timedOut} / 전체 ${totalPages}`);
  for (const f of summary.failedPages) console.log(`  - ${f.status}: ${f.course} ${f.menu} (${f.error ?? ''})`);
  console.log(`수집 항목: ${summary.items}개`);
  const g = summary.groups;
  console.log(`묶음: ${g.total}개 (이미지 ${g.images} · 문구 ${g.texts}) · 3과정 공통 ${g.in3Courses} · 2과정 ${g.in2Courses} · 한 과정만 ${g.in1Course} · 비교 불가 그림 ${g.notComparableImages}`);
  console.log(`걸린 시간: 전체 ${seconds(totalMs)} (수집 ${seconds(collectMs)}) — 목표 10분 이내 ${totalMs <= 600_000 ? '달성' : '초과'}`);
  console.log(`저장: ${file}`);
}

main().catch((error) => {
  console.error(error instanceof MenuError ? `⚠ ${error.message}` : error);
  process.exitCode = 1;
});
