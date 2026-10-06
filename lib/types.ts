// 화면과 서버가 함께 쓰는 데이터 모양 (DESIGN.md 6장)

/** 수집하는 과정 */
export type Course = '초등' | '중학' | '고교';

/** 화면에서 요소가 있는 영역 */
export type Region = '상단' | '본문' | '하단';

/** 수집 항목의 종류 */
export type ItemKind = '이미지' | '문구';

/** 수집할 페이지 하나 */
export interface PageTarget {
  course: Course;
  /** 메뉴 경로. 예: "주제보기 > 가정과 다문화" */
  menu: string;
  url: string;
}

/** 서버에 한 번에 맡기는 메뉴 묶음 (최대 6페이지) */
export interface Batch {
  id: string;
  course: Course;
  /** 화면 표시용 이름. 예: "중학 > 주제보기" */
  label: string;
  pages: PageTarget[];
}

/** 페이지 하나에서 읽어 온 이미지·문구 하나 */
export interface RawItem {
  kind: ItemKind;
  /** 이미지: 그림 주소 / 문구: 띄어쓰기를 정리한 글자 */
  value: string;
  /** 이미지 대체텍스트 */
  alt?: string;
  /** 이미지 파일 지문(해시). 그림을 받지 못하면 비어 있음 → "비교 불가" */
  hash?: string;
  region: Region;
  /** 탭·펼침 메뉴 속에 숨어 있는 요소인지 */
  hidden: boolean;
}

/** 페이지 하나의 수집 결과 */
export interface PageResult {
  target: PageTarget;
  /** 시간 초과: 묶음 시간 한도(100초) 때문에 열지 못한 페이지. 화면이 맨 뒤에 1번 더 보낸다 */
  status: '성공' | '수집 실패' | '시간 초과';
  /** 실패 이유. 예: "60초 안에 열리지 않음" */
  error?: string;
  items: RawItem[];
}

/**
 * 같은 항목이 놓인 위치 하나.
 * PRD의 "위치"는 menu · url · region 3가지이고, hidden은 엑셀의 별도 "숨김 여부" 열에 쓴다.
 */
export interface Location {
  course: Course;
  menu: string;
  url: string;
  region: Region;
  hidden: boolean;
}

/** 같은 이미지·문구끼리 묶은 결과 */
export interface Group {
  /** 공통ID. 예: IMG-001, TXT-001 */
  id: string;
  kind: ItemKind;
  /** 묶는 기준. 'I:'+파일 지문 / 'U:'+그림 주소(비교 불가) / 'T:'+문구 */
  key: string;
  /** 화면 표시용 (이미지 파일 이름 또는 문구) */
  display: string;
  imageUrl?: string;
  alt?: string;
  /** 그림 파일을 받지 못해 내용 비교를 못 했으면 false */
  comparable: boolean;
  /** 이 항목이 있는 과정 */
  courses: Course[];
  locations: Location[];
}

/** 과정 표시 순서 */
export const COURSES: Course[] = ['초등', '중학', '고교'];
