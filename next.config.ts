import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel에 배포할 때 브라우저 조종 도구(playwright-core)의 설정 파일(browsers.json 등)이 빠져
  // 메뉴 읽기·수집 API가 시작조차 못 하는 문제가 있어, 이 두 API에 도구 폴더 전체를 함께 싣는다.
  outputFileTracingIncludes: {
    "/api/menus": ["./node_modules/playwright-core/**/*"],
    "/api/collect": ["./node_modules/playwright-core/**/*"],
  },
};

export default nextConfig;
