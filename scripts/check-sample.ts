// 위치 정확도 점검 — 무작위 20개 (PRD 3장 성공 판단 방법, PLAN 작업 14, SC-3 사전 점검)
// dev-output/의 가장 최근 수집 결과에서 위치 20개를 무작위로 골라
//  1) 담당자가 실제 사이트에서 직접 확인할 확인표(마크다운)를 만들고
//  2) 브라우저로 각 위치를 다시 열어 자동으로 1차 확인한다.
// 자동 확인은 수집 코드(extract.ts)와 다른 방법을 쓴다(같은 코드로 자기 자신을 검사하지 않도록):
//  - 문구: 해당 영역의 전체 글자(textContent)를 띄어쓰기 정리한 뒤 그 문구가 들어 있는지
//  - 이미지: 해당 영역의 그림 주소를 모두 다시 내려받아, 같은 파일 지문이 있는지
//
// 실행: npm run check:sample                    (무작위)
//       npm run check:sample -- <번호>           (같은 번호를 주면 같은 20개를 다시 고름)
//       npm run check:sample -- <번호> <결과 파일> (가장 최근 파일 대신 이 파일로)
//
// Node가 TypeScript 파일을 바로 실행하므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { openPage, PAGE_TIMEOUT_MS, withBrowser } from '../lib/browser.ts';
import type { Group, Location, Region } from '../lib/types.ts';

const OUTPUT_DIR = 'dev-output';
const SAMPLE_SIZE = 20;
const GAP_MS = 1_000; // 사이트 부담을 줄이기 위해 페이지 사이 1초 (PRD 7장)

interface Sample {
  no: number;
  group: Group;
  location: Location;
  auto?: '있음' | '없음' | '열지 못함';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 같은 번호(seed)를 넣으면 같은 순서가 나오는 간단한 난수 */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** dev-output/에서 가장 최근 수집 결과 파일 */
function latestResultFile(): string {
  const files = readdirSync(OUTPUT_DIR).filter((f) => /^collect-.*\.json$/.test(f)).sort();
  if (files.length === 0) throw new Error('수집 결과가 없어요. 먼저 npm run collect:dev 를 실행하세요');
  return `${OUTPUT_DIR}/${files[files.length - 1]}`;
}

/** 모든 (묶음, 위치) 짝에서 겹치지 않게 n개를 무작위로 고른다 */
function pickSamples(groups: Group[], n: number, random: () => number): Sample[] {
  const pairs = groups.flatMap((group) => group.locations.map((location) => ({ group, location })));
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs.slice(0, n).map((p, i) => ({ no: i + 1, ...p }));
}

/** 페이지 안에서: 영역에 속하는 요소들의 글자와 그림 주소를 모은다(수집 코드와 다른 방법) */
async function readRegion(page: Page, region: Region): Promise<{ text: string; imageUrls: string[] }> {
  return page.evaluate((region) => {
    const regionOf = (el: Element): string => {
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
        const name = `${typeof e.className === 'string' ? e.className : ''} ${e.id}`;
        const tag = e.tagName.toLowerCase();
        if (tag === 'header' || /(^|[\s_-])(header|gnb)/i.test(name)) return '상단';
        if (tag === 'footer' || /footer/i.test(name)) return '하단';
      }
      return '본문';
    };
    // 영역의 "가장 바깥" 요소들만 모아 글자를 이어 붙인다
    const tops = [...document.body.querySelectorAll('*')].filter(
      (el) => regionOf(el) === region && (!el.parentElement || el.parentElement === document.body || regionOf(el.parentElement) !== region),
    );
    const text = tops.map((el) => el.textContent ?? '').join(' ').replace(/\s+/g, ' ');
    const imageUrls = new Set<string>();
    for (const el of [document.body, ...document.body.querySelectorAll('*')]) {
      if (regionOf(el) !== region && el !== document.body) continue;
      if (el instanceof HTMLImageElement && el.currentSrc) imageUrls.add(el.currentSrc);
      for (const m of getComputedStyle(el).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        if (!m[1].startsWith('data:')) imageUrls.add(new URL(m[1], location.href).href);
      }
    }
    return { text, imageUrls: [...imageUrls] };
  }, region);
}

/** 그림 파일 지문 (받지 못하면 null) */
async function fingerprint(page: Page, url: string): Promise<string | null> {
  try {
    const res = await page.request.get(url, { timeout: 10_000 });
    return res.ok() ? createHash('sha256').update(await res.body()).digest('hex') : null;
  } catch {
    return null;
  }
}

/** 한 위치를 자동으로 확인한다 */
async function autoCheck(page: Page, sample: Sample): Promise<Sample['auto']> {
  const { group, location } = sample;
  try {
    await openPage(page, location.url, PAGE_TIMEOUT_MS);
  } catch {
    return '열지 못함';
  }
  // 지연 로딩 그림을 위해 끝까지 스크롤
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 800) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  const { text, imageUrls } = await readRegion(page, location.region);
  if (group.kind === '문구') return text.includes(group.display) ? '있음' : '없음';

  if (!group.comparable) return imageUrls.includes(group.imageUrl ?? '') ? '있음' : '없음';
  const wanted = group.key.slice(2); // 'I:' 뒤의 파일 지문
  for (const url of imageUrls) if ((await fingerprint(page, url)) === wanted) return '있음';
  return '없음';
}

/** 담당자용 확인표 (마크다운) */
function checklist(samples: Sample[], source: string, seed: number): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = samples.map(({ no, group, location, auto }) =>
    [
      no,
      group.id,
      group.kind,
      cell(group.kind === '이미지' ? `${group.display}${group.alt ? ` (${group.alt})` : ''}` : group.display.slice(0, 60)),
      location.course,
      cell(location.menu),
      location.url,
      `${location.region}${location.hidden ? ' · 숨김' : ''}`,
      auto ?? '-',
      '☐',
    ].join(' | '),
  );
  const ok = samples.filter((s) => s.auto === '있음').length;
  return [
    '# 위치 정확도 점검표 (무작위 20개)',
    '',
    `- 원본 수집 결과: \`${source}\``,
    `- 고른 번호(seed): ${seed} — \`npm run check:sample -- ${seed}\`로 같은 20개를 다시 고를 수 있어요`,
    `- 자동 1차 확인: ${ok} / ${samples.length} 있음`,
    '- 확인 방법: 주소를 열고, 적힌 **영역**(상단/본문/하단)에 그 내용이 있으면 마지막 칸을 ☑로 바꾸세요. "숨김"은 탭·펼침 메뉴를 눌러야 보여요.',
    '',
    '| No | 공통ID | 구분 | 내용 | 과정 | 메뉴 | 페이지 주소 | 영역 | 자동 확인 | 직접 확인 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const seed = Number(process.argv[2]) || Math.floor(Math.random() * 1_000_000);
  const source = process.argv[3] ?? latestResultFile();
  const { groups } = JSON.parse(readFileSync(source, 'utf8')) as { groups: Group[] };
  const samples = pickSamples(groups, SAMPLE_SIZE, seededRandom(seed));
  console.log(`원본: ${source} · 묶음 ${groups.length}개 · 고른 번호 ${seed}`);

  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    for (const sample of samples) {
      if (sample.no > 1) await sleep(GAP_MS);
      sample.auto = await autoCheck(page, sample);
      const { group, location } = sample;
      console.log(`  ${String(sample.no).padStart(2)}. ${sample.auto} · ${group.id} ${group.display.slice(0, 30)} · ${location.course} ${location.menu} · ${location.region}${location.hidden ? '(숨김)' : ''}`);
    }
  });

  const file = `${OUTPUT_DIR}/sample-check-${seed}.md`;
  writeFileSync(file, checklist(samples, source, seed), 'utf8');
  const ok = samples.filter((s) => s.auto === '있음').length;
  console.log(`\n자동 1차 확인: ${ok} / ${samples.length} 있음 ${ok === samples.length ? '— 목표(20개 중 20개) 충족' : '— 확인이 필요한 항목이 있어요'}`);
  console.log(`확인표: ${file} (실제 사이트에서 직접 확인하고 ☑ 표시하세요)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? `⚠ ${error.message}` : error);
  process.exitCode = 1;
});
