// AI 판단 계획 — 파일 내용이 같은 그림은 AI에 한 번만 보내고, 그 결과를 같은 내용의 다른 주소에도 나눠 준다
// (DESIGN.md 4장, PRD must 1 "같은 그림은 한 번만", 분석 G-01·G-02)
// 브라우저 없이 계산만 하므로 화면(lib/run-steps.ts)과 개발용 실행(scripts/run-dev.ts)이 함께 쓴다.
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Judgement, PageResult } from './refresh-types.ts';

/** AI에 보낼 대표 그림 주소와, 대표마다 같은 내용의 주소 목록 */
export interface JudgePlan {
  /** AI에 보낼 주소 (찾은 순서) */
  representatives: string[];
  /** 대표 주소 → 같은 내용의 모든 주소 (대표 포함) */
  members: Map<string, string[]>;
}

/** 수집 결과에서 판단 계획을 만든다. 지문을 못 구한 그림은 주소별로 따로 판단한다 */
export function planJudging(results: PageResult[]): JudgePlan {
  const repOfKey = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const image of results.flatMap((r) => r.images)) {
    const key = image.sha256 ? `sha:${image.sha256}` : `src:${image.src}`;
    const rep = repOfKey.get(key);
    if (!rep) {
      repOfKey.set(key, image.src);
      members.set(image.src, [image.src]);
    } else if (!members.get(rep)!.includes(image.src)) {
      members.get(rep)!.push(image.src);
    }
  }
  return { representatives: [...members.keys()], members };
}

/** 대표 그림의 판단을 같은 내용의 모든 주소에 나눠 준다 (주소 → 판단) */
export function spreadJudgements(plan: JudgePlan, judged: Map<string, Judgement>): Map<string, Judgement> {
  const all = new Map<string, Judgement>();
  for (const [rep, srcs] of plan.members) {
    const j = judged.get(rep);
    if (!j) continue;
    for (const src of srcs) all.set(src, src === rep ? j : { ...j, src, usage: undefined });
  }
  return all;
}
