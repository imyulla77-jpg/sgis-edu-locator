// POST /api/judge — 그림 하나의 최고 연도를 Claude AI로 읽고 판정한다 (DESIGN.md 4·7장, PLAN 작업 9·10)
// 입력: { src }   출력: Judgement   오류: { error } (화면에 그대로 보여 줘도 되는 문장)
// 그림을 못 받거나 AI가 답하지 못하면 200 + 판정 "확인 필요"로 돌려준다. AI 요청 한도에 걸리면 429.

import { isJudgeableImage, JudgeBusyError, judgeImage } from '@/lib/ai-judge';
import { passwordResponse } from '@/lib/run-password';
import { busyResponse, crossSiteResponse, JUDGE_BUSY_MESSAGE, JUDGE_SLOTS, tryAcquire } from '@/lib/server-limit';

/** 최대 실행 시간(초). 그림 받기 10초 + AI 답(재시도 포함) 여유 */
export const maxDuration = 60;

export async function POST(request: Request) {
  // 다른 웹사이트가 몰래 보낸 요청은 거절한다(CHECK.md SEC-003)
  const crossSite = crossSiteResponse(request);
  if (crossSite) return crossSite;
  // 배포본에서는 실행 비밀번호가 있어야 한다 — 남이 AI 요금을 쓰지 못하게(CHECK.md SEC-004)
  const wrongPassword = passwordResponse(request);
  if (wrongPassword) return wrongPassword;

  const body = await request.json().catch(() => null);
  const src = typeof body?.src === 'string' ? body.src.trim() : '';
  // SGIS에듀 콘텐츠 그림만 AI에 보낸다(CHECK.md SEC-006)
  if (!isJudgeableImage(src)) return Response.json({ error: 'SGIS에듀 콘텐츠 그림 주소만 판단할 수 있어요' }, { status: 400 });

  // AI 판단은 한 번에 3개까지(CHECK.md SEC-002)
  const release = tryAcquire('judge', JUDGE_SLOTS);
  if (!release) return busyResponse(JUDGE_BUSY_MESSAGE);
  try {
    return Response.json(await judgeImage(src));
  } catch (error) {
    if (error instanceof JudgeBusyError) return busyResponse(error.message);
    console.error('[api/judge]', error instanceof Error ? error.name : 'unknown');
    return Response.json({ error: 'AI 판단 중 문제가 생겼어요' }, { status: 500 });
  } finally {
    release();
  }
}
