// 주소 검사 — 화면과 서버가 함께 쓴다 (PRD must 1, DESIGN.md 7·10장)

/** 수집을 허용하는 주소의 시작 부분 */
export const ALLOWED_PREFIX = 'https://sgis.mods.go.kr/';

/** 시작 주소 입력칸의 기본값 */
export const DEFAULT_START_URL = 'https://sgis.mods.go.kr/view/edu/index';

/** 주소가 잘못됐을 때 보여 줄 안내 */
export const URL_ERROR_MESSAGE = 'sgis.mods.go.kr 주소만 사용할 수 있어요';

/** sgis.mods.go.kr 주소인지 확인한다. 앞뒤 공백은 무시한다. */
export function isAllowedUrl(input: string): boolean {
  const url = input.trim();
  if (!url.startsWith(ALLOWED_PREFIX)) return false;
  try {
    // "https://sgis.mods.go.kr/../" 같은 꼼수 주소도 실제 호스트로 한 번 더 확인
    return new URL(url).host === 'sgis.mods.go.kr';
  } catch {
    return false;
  }
}

/** 수집하는 페이지 경로: 에듀 화면(/view/edu/…)과 에듀 부속 화면(/view/edu_gallery/… 등) */
const COLLECT_PATH = /^\/view\/edu(_[a-z0-9]+)?\//i;

/** 수집할 수 없는 페이지일 때 보여 줄 안내 */
export const PAGE_PATH_ERROR_MESSAGE = 'SGIS에듀 화면(/view/edu/…)만 수집할 수 있어요';

/**
 * 수집해도 되는 페이지 주소인지 확인한다(sgis 주소이면서 에듀 화면 경로).
 * 서버 API를 직접 불러 로그인 화면 등 에듀 밖의 페이지를 열게 하지 못하도록 쓴다(CHECK.md SEC-009).
 */
export function isCollectablePage(input: string): boolean {
  return isAllowedUrl(input) && COLLECT_PATH.test(new URL(input.trim()).pathname);
}
