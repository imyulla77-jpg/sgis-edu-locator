// [서버] 동시 실행 제한 — 서버 브라우저·그림 받기를 한 번에 정해진 개수까지만 돌린다 (CHECK.md SEC-001, DESIGN.md 7장)
// 누가 API를 한꺼번에 많이 불러도 서버가 브라우저를 여러 개 띄우거나 SGIS에 요청을 몰아 보내지 않게 한다.
// 서버 한 대(한 프로세스) 안에서만 지켜진다. 인터넷 공개 시에는 Vercel 비밀번호 보호를 함께 켠다.

/** 서버 브라우저를 쓰는 작업(메뉴 읽기·수집)은 합쳐서 한 번에 1개 */
export const BROWSER_SLOTS = 1;

/** 그림 대신 받기는 한 번에 3개 (화면의 미리보기 준비가 3개씩 받는다 — lib/thumbnail.ts) */
export const IMAGE_SLOTS = 3;

export const BROWSER_BUSY_MESSAGE = '다른 수집이 진행 중이에요. 끝난 뒤 다시 시도하세요';
export const IMAGE_BUSY_MESSAGE = '그림 요청이 많아요. 잠시 뒤 다시 시도하세요';

// 개발 서버에서는 API마다 코드가 따로 불러와질 수 있어, 숫자를 globalThis에 두어 모든 API가 같은 값을 보게 한다
const store = globalThis as typeof globalThis & { __sgisRunning?: Record<string, number> };
const running = (store.__sgisRunning ??= {});

/**
 * 자리가 있으면 하나 차지하고 "자리 돌려주기" 함수를, 자리가 없으면 null을 돌려준다.
 * 돌려주기 함수는 작업이 끝나면(성공·실패 모두) 꼭 한 번 불러야 한다.
 */
export function tryAcquire(name: string, max: number): (() => void) | null {
  if ((running[name] ?? 0) >= max) return null;
  running[name] = (running[name] ?? 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    running[name] -= 1;
  };
}

/** 자리가 없을 때 돌려주는 응답 (429: 요청이 너무 많음) */
export function busyResponse(message: string): Response {
  return Response.json({ error: message }, { status: 429, headers: { 'Retry-After': '10' } });
}
