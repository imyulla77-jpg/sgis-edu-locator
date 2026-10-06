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
