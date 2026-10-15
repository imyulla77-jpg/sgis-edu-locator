import type { NextConfig } from "next";

/** 메뉴 읽기·수집 API가 배포 서버에서 쓰는 파일 */
const BROWSER_FILES = [
  // 브라우저 조종 도구(playwright-core)의 설정 파일(browsers.json 등) — 빠지면 API가 시작조차 못 함
  "./node_modules/playwright-core/**/*",
  // 서버용 크롬 실행 파일(압축본) — Vercel에는 Edge·Chrome이 없어 이것을 풀어서 씀
  "./node_modules/@sparticuz/chromium/bin/**/*",
];

const nextConfig: NextConfig = {
  // Vercel에 배포할 때 위 파일들이 자동으로 실리지 않아, 브라우저를 띄우는 API에 함께 싣는다.
  outputFileTracingIncludes: {
    "/api/menus": BROWSER_FILES,
    "/api/targets": BROWSER_FILES,
    "/api/collect": BROWSER_FILES,
  },
};

export default nextConfig;
