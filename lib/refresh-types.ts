// 2판(현행화 대상 찾기) 화면과 서버가 함께 쓰는 데이터 모양 (DESIGN.md 6장)
// (1판 lib/types.ts는 2026-10-15 화면 교체 때 trash-can으로 옮겼다.)

/** 검색하는 과정 */
export type Course = '초등' | '중학' | '고교';

/** 검색 대상 2단계 메뉴 (PRD 4장 표) */
export type Level2 = '수업하기' | '스스로하기' | '주제보기';

/** 그림 판정. 판정은 AI가 아니라 코드가 최고 연도로 정한다 (DESIGN.md 4장) */
export type Verdict = '현행화 대상' | '대상 아님' | '연도 없음' | '확인 필요';

/** 홈페이지 경로를 찾는 SGIS 홈페이지 메뉴 4개 */
export type HomeMenu = '통계주제도' | '대화형 통계지도' | '활용서비스' | '분석지도';

/** 현행화 대상으로 보는 최고 연도의 끝 (이 해 이하면 대상) */
export const TARGET_MAX_YEAR = 2026;

export const COURSES: Course[] = ['초등', '중학', '고교'];

/** 콘텐츠가 나오는 메뉴 위치 하나. 예: 초등 > 주제보기 > 인구와 고령화 */
export interface MenuLocation {
  course: Course;
  level2: Level2;
  level3: string;
  /** 이 위치에서 콘텐츠를 여는 주소 (수업하기는 classDetail, 주제보기는 issueDetail) */
  url: string;
}

/** 실제로 여는 페이지 하나. 같은 콘텐츠는 한 번만 열고 나오는 위치를 모두 붙인다 */
export interface PageTarget {
  /** 콘텐츠 번호(예: E0101). 스스로하기처럼 메뉴 자체가 내용 화면이면 null */
  contentsId: string | null;
  /** 서버 브라우저가 여는 주소 */
  openUrl: string;
  /** 상세 페이지 제목 (페이지를 연 뒤 채움) */
  title?: string;
  locations: MenuLocation[];
}

/** SGIS 홈페이지 4개 메뉴의 하위 메뉴 하나 (홈페이지 상단 메뉴에서 매번 읽음) */
export interface HomeMenuItem {
  menu: HomeMenu;
  /** 예: 지방의 변화보기 */
  name: string;
  url: string;
}

/** /api/targets 결과 */
export interface TargetList {
  pages: PageTarget[];
  homeMenus: HomeMenuItem[];
  /** 화면에 보여 줄 주의 문장 (표의 메뉴를 사이트에서 못 찾음 등) */
  warnings: string[];
}

/** 바로가기 버튼으로 찾은 SGIS 홈페이지 경로 */
export interface HomeLink {
  /** 4개 메뉴 밖이면 null → "홈페이지 경로 없음" */
  menu: HomeMenu | null;
  /** 하위 이름 (버튼 문구 괄호 안). 예: 지방의 변화보기 */
  sub: string;
  url: string;
  /** 예: "버튼 문구 기준" */
  note?: string;
}

/** 상세 페이지의 "SGIS ○○ 바로가기" 버튼 하나 */
export interface DirectButton {
  /** 버튼 문구. 예: SGIS 분석지도(지방의 변화보기) 바로가기 */
  text: string;
  /** 버튼이 여는 주소 (전체 주소) */
  url: string;
}

/** 상세 페이지에서 찾은 본문 그림 하나 */
export interface FoundImage {
  src: string;
  /** 그림이 속한 소제목 영역(슬라이드). 예: "1번 화면: 우리나라의 인구변화" */
  section: string;
  /** 소제목 영역 안에서 몇 번째 그림인지 (1부터) */
  indexInSection: number;
  /** 그림 캡처 (JPEG base64, 긴 변 최대 400픽셀, 엑셀 "캡처" 칸). 그리지 못하면 null */
  capture: string | null;
  /** 그림 파일 내용 지문(sha256). 수집 때 서버가 그림을 받아 만든다. 받지 못하면 null (같은 내용 그림은 AI에 한 번만 보냄) */
  sha256: string | null;
  /** 같은 소제목 영역의 바로가기 버튼. 없거나 짝을 정할 수 없으면 null (홈페이지 경로는 화면이 home-link.ts로 정함) */
  button: DirectButton | null;
  /** button이 null인 이유 */
  buttonNote?: string;
}

/** 그림이 있는 소제목 영역에서 찾은, 2026년 이하 연도가 들어간 문장 하나 */
export interface YearSentence {
  section: string;
  text: string;
  /** 문장이 들어 있는 화면 요소(문단·목록 한 줄) 캡처 (JPEG base64). 못 찍으면 null → "캡처 불가" */
  capture: string | null;
  /** 같은 영역의 그림 주소 */
  relatedImageSrcs: string[];
}

/** 페이지 하나 수집 결과 */
export interface PageResult {
  target: PageTarget;
  status: '성공' | '수집 실패' | '시간 초과';
  error?: string;
  images: FoundImage[];
  sentences: YearSentence[];
  seconds: number;
}

/**
 * 시트 1(현행화_기록)의 행 하나 = (현행화 대상·확인 필요 그림 또는 수정 필요 문장) × (메뉴 위치 1곳) (DESIGN.md 9장)
 * lib/records.ts가 만들고, 시트 2·3도 이 행으로 만든다.
 */
export interface RecordRow {
  /** 1부터 */
  no: number;
  kind: '그림' | '문장';
  /** JPEG base64 (그림: 그림 캡처, 문장: 문장 캡처). 없으면 null */
  capture: string | null;
  location: MenuLocation;
  pageTitle: string;
  contentsId: string | null;
  section: string;
  /** 그림 행: 영역 안 몇 번째 그림 */
  imageIndex?: number;
  /** 그림 행: 그림 주소 */
  src?: string;
  /** 그림 행: 파일 지문 (같은 그림 묶기용) */
  sha256?: string | null;
  years?: number[];
  maxYear?: number | null;
  verdict?: Verdict;
  /** 그림 행: 홈페이지 경로 (바로가기가 없으면 null) */
  homeLink?: HomeLink | null;
  /** 문장 행: 수정 전 내용 */
  before?: string;
  /** 문장 행: 같은 영역의 대상·확인 필요 그림 파일 이름 */
  relatedImages?: string[];
  /** 확인 필요 이유, 홈페이지 경로 비고 등 */
  note: string;
}

/** 그림 하나의 AI 판단 결과 */
export interface Judgement {
  src: string;
  /** 그림 파일 내용 지문. 그림을 받지 못하면 null */
  sha256: string | null;
  /** AI가 그림에서 읽은 4자리 연도들 */
  years: number[];
  maxYear: number | null;
  verdict: Verdict;
  /** 실제로 답한 모델 이름 (대체 모델이 답했으면 그 이름) */
  model: string | null;
  /** AI가 쓴 토큰 수 (요금 계산용). AI를 부르지 않았으면 없음 */
  usage?: { inputTokens: number; outputTokens: number };
  /** 확인 필요 이유 */
  error?: string;
}
