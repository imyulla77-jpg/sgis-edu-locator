// [서버 전용] 실행 비밀번호 검사 (DESIGN.md 7장, CHECK.md SEC-004)
// 배포본은 누구나 열 수 있어서, 남이 검색을 돌려 AI 요금이 나가지 않게 막는다.
// 서버 환경변수 RUN_PASSWORD가 있을 때만 검사한다(Vercel에만 넣고, 담당자 PC의 .env에는 넣지 않음).
// 화면은 머리말 x-run-password로 보낸다. 비밀번호는 로그·오류 메시지에 남기지 않는다.

import { timingSafeEqual } from 'node:crypto';

/** 화면이 비밀번호를 보내는 머리말 이름 */
export const RUN_PASSWORD_HEADER = 'x-run-password';

export const RUN_PASSWORD_MESSAGE = '실행 비밀번호가 맞지 않아요';

/** 비밀번호가 필요한지 (화면이 비밀번호 칸을 보일지 정할 때 씀) */
export function isPasswordRequired(): boolean {
  return Boolean(process.env.RUN_PASSWORD);
}

/** 비밀번호가 맞거나 필요 없으면 null, 틀렸으면 401 응답을 돌려준다 */
export function passwordResponse(request: Request): Response | null {
  const expected = process.env.RUN_PASSWORD;
  if (!expected) return null;
  const given = request.headers.get(RUN_PASSWORD_HEADER) ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // 길이가 다르면 timingSafeEqual이 오류를 내므로 먼저 거른다
  if (a.length === b.length && timingSafeEqual(a, b)) return null;
  return Response.json({ error: RUN_PASSWORD_MESSAGE, passwordRequired: true }, { status: 401 });
}
