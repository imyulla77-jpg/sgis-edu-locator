// 개발용 전체 실행 — 화면 없이 대상 찾기 → 수집 → AI 판단 → 시트 1 행 만들기를 실제로 돌려 dev-output/에 저장한다
// (DESIGN.md 12·13장, PLAN 작업 13·14)
// 실행: npm run refresh:dev            (기본 시작 주소)
//       npm run refresh:dev -- <주소>   (다른 시작 주소)
// AI 판단에 Claude API를 쓰므로 요금이 생긴다(한 번에 약 1~4달러). 키는 .env의 ANTHROPIC_API_KEY.
// 결과에서 시트 1 행 20개를 무작위로 골라 대조표(sample.md)와 캡처 그림을 함께 저장한다(CLAUDE.md 8장).
//
// Node가 TypeScript 파일을 바로 실행하므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import { mkdirSync, writeFileSync } from 'node:fs';
import { JudgeBusyError, JUDGE_MODEL, judgeImage } from '../lib/ai-judge.ts';
import { buildRecords, fileNameOf } from '../lib/records.ts';
import { collectPages, MAX_PAGES_PER_REQUEST } from '../lib/refresh-collect.ts';
import type { Judgement, PageResult } from '../lib/refresh-types.ts';
import { JUDGE_SLOTS } from '../lib/server-limit.ts';
import { SITE_UNAVAILABLE_MESSAGE } from '../lib/site-check.ts';
import { loadTargets } from '../lib/targets.ts';
import { DEFAULT_START_URL } from '../lib/url.ts';

/** 결과를 저장하는 폴더 (내부용 결과라 .gitignore에 등록) */
const OUTPUT_DIR = 'dev-output';

/** Claude Opus 5.5 요금 (달러 / 100만 토큰) — 요금 추정용 */
const PRICE_PER_MTOK = { input: 4, output: 20 };

/** 무작위로 고르는 대조 행 수 (CLAUDE.md 8장) */
const SAMPLE_SIZE = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms: number) => `${Math.round(ms / 1000)}초`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** AI 판단: 한 번에 JUDGE_SLOTS개씩. 요청 한도에 걸리면 5초 쉬고 1번 더 */
async function judgeAll(srcs: string[], onProgress: (done: number) => void): Promise<Map<string, Judgement>> {
  const results = new Map<string, Judgement>();
  let next = 0;
  async function worker() {
    while (next < srcs.length) {
      const src = srcs[next++];
      let judgement: Judgement;
      try {
        judgement = await judgeImage(src);
      } catch (error) {
        if (!(error instanceof JudgeBusyError)) throw error;
        await sleep(5_000);
        judgement = await judgeImage(src).catch(() => ({
          src, sha256: null, years: [], maxYear: null, verdict: '확인 필요' as const, model: null, error: 'AI 요청이 많아 판단하지 못함',
        }));
      }
      results.set(src, judgement);
      onProgress(results.size);
    }
  }
  await Promise.all(Array.from({ length: JUDGE_SLOTS }, worker));
  return results;
}

/** 정해진 씨앗으로 섞는다(같은 결과 파일이면 같은 20개가 뽑히게) */
function seededSample<T>(items: T[], n: number, seed: number): T[] {
  const a = [...items];
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

async function main(): Promise<void> {
  const startUrl = process.argv[2] ?? DEFAULT_START_URL;
  if (!process.env.ANTHROPIC_API_KEY) console.log('주의: ANTHROPIC_API_KEY가 없어 모든 그림이 "확인 필요"가 됩니다');
  const runId = stamp();
  const t0 = Date.now();
  console.log(`시작 주소: ${startUrl}`);

  // ① 대상 찾기
  const targets = await loadTargets(startUrl, { onRetry: (what, n) => console.log(`  다시 시도 ${n}번째: ${what}`) });
  console.log(`대상 찾기 완료: ${targets.pages.length}페이지 · 홈페이지 메뉴 ${targets.homeMenus.length}개 · ${seconds(Date.now() - t0)}`);
  for (const w of targets.warnings) console.log(`  경고: ${w}`);

  // ② 수집 (화면과 같이 4페이지씩, 처음 3개 연속 실패면 멈춤)
  const t1 = Date.now();
  const results: PageResult[] = [];
  for (let i = 0; i < targets.pages.length; i += MAX_PAGES_PER_REQUEST) {
    results.push(...(await collectPages(targets.pages.slice(i, i + MAX_PAGES_PER_REQUEST))));
    const failed = results.filter((r) => r.status !== '성공').length;
    console.log(`  수집 [${results.length}/${targets.pages.length}] 실패 ${failed}`);
    if (results.length >= 3 && results.slice(0, 3).every((r) => r.status !== '성공')) {
      console.log(SITE_UNAVAILABLE_MESSAGE);
      return;
    }
  }
  const collectMs = Date.now() - t1;

  // ③ AI 판단 (같은 주소는 한 번만)
  const t2 = Date.now();
  const srcs = [...new Set(results.flatMap((r) => r.images.map((i) => i.src)))];
  const judgements = await judgeAll(srcs, (done) => {
    if (done % 20 === 0 || done === srcs.length) console.log(`  AI 판단 [${done}/${srcs.length}]`);
  });
  const judgeMs = Date.now() - t2;

  // ④ 시트 1 행
  const records = buildRecords(results, judgements, targets.homeMenus);
  const totalMs = Date.now() - t0;

  // ⑤ 요약
  const js = [...judgements.values()];
  const countVerdict = (v: string) => js.filter((j) => j.verdict === v).length;
  const inputTokens = js.reduce((s, j) => s + (j.usage?.inputTokens ?? 0), 0);
  const outputTokens = js.reduce((s, j) => s + (j.usage?.outputTokens ?? 0), 0);
  const dollars = (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1_000_000;
  const summary = {
    startUrl,
    runId,
    model: JUDGE_MODEL,
    seconds: { total: Math.round(totalMs / 1000), collect: Math.round(collectMs / 1000), judge: Math.round(judgeMs / 1000) },
    pages: { total: results.length, failed: results.filter((r) => r.status !== '성공').length },
    images: { found: results.reduce((s, r) => s + r.images.length, 0), unique: srcs.length, uniqueFiles: new Set(js.map((j) => j.sha256).filter(Boolean)).size },
    verdicts: { 현행화대상: countVerdict('현행화 대상'), 대상아님: countVerdict('대상 아님'), 연도없음: countVerdict('연도 없음'), 확인필요: countVerdict('확인 필요') },
    fallbackModels: [...new Set(js.map((j) => j.model).filter((m) => m && m !== JUDGE_MODEL))],
    sentencesFound: results.reduce((s, r) => s + r.sentences.length, 0),
    records: { total: records.length, images: records.filter((r) => r.kind === '그림').length, sentences: records.filter((r) => r.kind === '문장').length },
    tokens: { input: inputTokens, output: outputTokens, dollars: Math.round(dollars * 100) / 100 },
  };

  // ⑥ 저장: 전체 결과 + 무작위 20행 대조표
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = `${OUTPUT_DIR}/refresh-${runId}.json`;
  writeFileSync(file, JSON.stringify({ summary, targets, results, judgements: js, records }, null, 1));
  const sampleDir = `${OUTPUT_DIR}/sample-${runId}`;
  mkdirSync(sampleDir, { recursive: true });
  const sample = seededSample(records, SAMPLE_SIZE, Number(runId.replace(/\D/g, '').slice(-8)));
  const lines = [`# 무작위 ${sample.length}행 대조표 (${runId})`, '', '| # | 구분 | 위치 | 영역 | 내용 | 판정·경로 | 캡처 |', '|---|---|---|---|---|---|---|'];
  sample.forEach((r, i) => {
    const capture = r.capture ? `${String(i + 1).padStart(2, '0')}.jpg` : '';
    if (r.capture) writeFileSync(`${sampleDir}/${capture}`, Buffer.from(r.capture, 'base64'));
    const where = `${r.location.course}>${r.location.level2}>${r.location.level3} · ${r.pageTitle} · ${r.location.url}`;
    const what = r.kind === '그림' ? `${fileNameOf(r.src ?? '')} (${r.imageIndex}번째)` : (r.before ?? '').replace(/\|/g, '/');
    const judged = r.kind === '그림'
      ? `${r.verdict} · 최고 ${r.maxYear ?? '-'} [${(r.years ?? []).join(',')}] · ${r.homeLink ? `${r.homeLink.menu} > ${r.homeLink.sub} (${r.homeLink.url})` : '경로 없음'}`
      : `관련 그림: ${(r.relatedImages ?? []).join(', ')}`;
    lines.push(`| ${r.no} | ${r.kind} | ${where} | ${r.section} | ${what} | ${judged} ${r.note ? `· ${r.note}` : ''} | ${capture} |`);
  });
  writeFileSync(`${sampleDir}/sample.md`, lines.join('\n'));

  console.log(JSON.stringify(summary, null, 1));
  console.log(`저장: ${file}, ${sampleDir}/sample.md`);
}

main().catch((error) => {
  console.error('실행 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
