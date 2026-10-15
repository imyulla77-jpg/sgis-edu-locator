// [서버 전용] 열린 상세 페이지에서 그림·소제목·바로가기·연도 문장 읽기와 캡처 (DESIGN.md 2.2·2.3·5장, PLAN 작업 8·12)
// - 상세 페이지(수업 상세·스스로하기)는 슬라이드(넘겨 보는 화면) 하나가 소제목 영역 하나다(.slideObj, 복제본 제외)
// - 본문 내용 그림만 읽는다: /sgis_edu/resource/images/contents/ 아래 그림 중 목록 미리보기(_thumb)·/upload/ 제외
// - 바로가기 버튼은 같은 슬라이드 안의 그림과만 짝짓는다(본문 그래프에 다른 슬라이드의 버튼 경로를 붙이지 않기 위함)
// - 연도 문장: 그림이 있는 슬라이드에서 1900~2026 사이 4자리 연도가 들어간 문장
// - 슬라이드가 넘겨져 있지 않아 화면에 안 보여도 읽을 수 있도록, 그림 캡처는 페이지 안에서 그림을 다시 그려 만들고,
//   문장 캡처는 그 문장 요소를 화면 맨 위에 복사해 찍는다
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import type { Page } from 'playwright-core';
import type { DirectButton, FoundImage, YearSentence } from './refresh-types.ts';
import { TARGET_MAX_YEAR } from './refresh-types.ts';

/** 그림 캡처의 긴 변 최대 픽셀 */
export const IMAGE_CAPTURE_MAX_SIDE = 400;

/** 문장 캡처를 찍을 때 복사본의 최대 너비(픽셀) */
const TEXT_CAPTURE_MAX_WIDTH = 800;

/** 페이지 하나에서 찍는 문장 캡처 최대 수 (응답이 너무 커지지 않게) */
const MAX_TEXT_CAPTURES = 40;

/** 페이지 안에서 읽은 결과 (캡처 전) */
interface RawExtract {
  title: string;
  images: (Omit<FoundImage, 'button' | 'buttonNote'> & { button: DirectButton | null; buttonNote?: string })[];
  sentences: (Omit<YearSentence, 'capture'> & { captureKey: string | null })[];
}

/**
 * 페이지 안에서 실행되는 읽기 함수. 브라우저로 보내져 실행되므로 이 함수 밖의 변수·함수를 쓰면 안 된다.
 * 문장이 들어 있는 요소에는 data-refresh-cap 표시를 붙여, 서버가 나중에 그 요소를 찍을 수 있게 한다.
 */
async function readInPage(args: { maxYear: number; maxSide: number }): Promise<RawExtract> {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const isContentImage = (src: string) => {
    let path = '';
    try {
      path = new URL(src, location.href).pathname;
    } catch {
      return false;
    }
    return /^\/sgis_edu\/resource\/images\/contents\//.test(path) && !/_thumb\./i.test(path) && !/\/upload\//i.test(path);
  };
  const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

  // 그림을 캔버스에 줄여 그려 JPEG로 만든다(같은 사이트 그림이라 그릴 수 있음). 못 그리면 null
  const drawImage = async (img: HTMLImageElement): Promise<string | null> => {
    try {
      let source: HTMLImageElement = img;
      if (!img.complete || img.naturalWidth === 0) {
        source = new Image();
        source.src = img.src;
        await source.decode();
      }
      const w = source.naturalWidth;
      const h = source.naturalHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, args.maxSide / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff'; // 투명한 부분은 흰 바탕으로
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? null;
    } catch {
      return null;
    }
  };

  // 4자리 연도 찾기: 앞뒤가 숫자가 아닌 1900~2099
  const yearsIn = (s: string) => [...s.matchAll(/(?<!\d)(19\d{2}|20\d{2})(?!\d)/g)].map((m) => Number(m[1]));
  // 문장 나누기: 마침표·물음표·느낌표 뒤 띄어쓰기, 줄바꿈
  const splitSentences = (s: string) =>
    s
      .split(/(?<=[.?!])\s+|\n+/)
      .map(clean)
      .filter(Boolean);

  // 상세 제목: 왼쪽 메뉴의 .lnbTi(수업 상세), 없으면 본문 첫 제목 .contTi(스스로하기), 그것도 없으면 창 제목
  const title = clean(document.querySelector('.lnb .lnbTi')?.textContent) || clean(document.querySelector('.contTi')?.textContent) || clean(document.title);

  let sections = [...document.querySelectorAll<HTMLElement>('.slideObj:not(.slick-cloned)')];
  if (sections.length === 0) sections = [document.querySelector<HTMLElement>('main') ?? document.body];

  const images: RawExtract['images'] = [];
  const sentences: RawExtract['sentences'] = [];
  let capCount = 0;
  const seenSentence = new Set<string>();

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const heading = clean(sec.querySelector('.imgTi, h2, h3, .contTi')?.textContent);
    const section = `${i + 1}번 화면${heading ? `: ${shorten(heading, 40)}` : ''}`;

    // 그림 (같은 슬라이드 안에서 같은 주소는 한 번만)
    const imgs = [...sec.querySelectorAll<HTMLImageElement>('img')].filter((img) => isContentImage(img.getAttribute('src') ?? ''));
    const uniqueImgs = imgs.filter((img, idx) => imgs.findIndex((o) => o.src === img.src) === idx);
    if (uniqueImgs.length === 0) continue;

    // 바로가기 버튼: onclick="window.open('/statbd/future_01.vw')"
    const buttons: DirectButton[] = [...sec.querySelectorAll('button, a')]
      .map((el) => {
        const m = (el.getAttribute('onclick') ?? '').match(/window\.open\(\s*'([^']+)'/);
        return m ? { text: clean(el.textContent), url: new URL(m[1], location.href).href } : null;
      })
      .filter((b): b is DirectButton => Boolean(b && /바로\s*가기/.test(b.text)));

    for (let k = 0; k < uniqueImgs.length; k++) {
      let button: DirectButton | null = null;
      let buttonNote: string | undefined;
      if (buttons.length === 1) button = buttons[0];
      else if (buttons.length === 0) buttonNote = '바로가기 버튼 없음';
      else if (buttons.length === uniqueImgs.length) button = buttons[k]; // 그림과 버튼 수가 같으면 순서대로 짝
      else buttonNote = '바로가기 버튼이 여러 개라 짝을 정할 수 없음';
      images.push({
        src: uniqueImgs[k].src,
        section,
        indexInSection: k + 1,
        capture: await drawImage(uniqueImgs[k]),
        sha256: null, // 지문은 페이지 밖에서 서버가 그림을 받아 붙인다(refresh-collect.ts)
        button,
        buttonNote,
      });
    }

    // 연도 문장: 글자를 가진 가장 안쪽 블록(목록 한 줄·문단·그림 설명 등)에서 찾는다
    const blockSelector = 'li, p, figcaption, dd, td, .imgTi, .tip, h2, h3, h4';
    const blocks = [...sec.querySelectorAll<HTMLElement>(blockSelector)].filter((el) => !el.querySelector(blockSelector));
    const related = uniqueImgs.map((img) => img.src);
    for (const block of blocks) {
      for (const text of splitSentences(block.innerText || block.textContent || '')) {
        if (!yearsIn(text).some((y) => y >= 1900 && y <= args.maxYear)) continue;
        const key = `${section}|${text}`;
        if (seenSentence.has(key)) continue;
        seenSentence.add(key);
        let captureKey: string | null = null;
        if (capCount < 40) {
          captureKey = block.getAttribute('data-refresh-cap') ?? String(capCount++);
          block.setAttribute('data-refresh-cap', captureKey);
        }
        sentences.push({ section, text, relatedImageSrcs: related, captureKey });
      }
    }
  }
  return { title, images, sentences };
}

/**
 * 표시해 둔 문장 요소를 화면 맨 위에 복사해 찍는다(슬라이드가 넘겨져 있어 안 보여도 찍을 수 있게).
 * 복사본은 원래 요소의 부모 두 단계 모양(태그·class)을 함께 만들어 글자 모양이 비슷하게 나오게 한다. 못 찍으면 null
 */
async function captureBlock(page: Page, key: string): Promise<string | null> {
  try {
    const ok = await page.evaluate(
      ({ key, maxWidth }) => {
        document.getElementById('__refresh_cap')?.remove();
        const el = document.querySelector<HTMLElement>(`[data-refresh-cap="${key}"]`);
        if (!el) return false;
        const box = document.createElement('div');
        box.id = '__refresh_cap';
        box.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;background:#fff;padding:8px;width:${maxWidth}px;box-sizing:border-box;`;
        // 부모 두 단계를 같은 태그·class로 만들어 넣는다(목록 번호·글자 모양 유지)
        let inner: HTMLElement = box;
        const parents = [el.parentElement?.parentElement, el.parentElement].filter((p): p is HTMLElement => Boolean(p));
        for (const p of parents) {
          const shell = document.createElement(p.tagName);
          // 슬라이드 이름표(slick-…)는 빼고 복사한다. 슬라이드 밖에서 slick-slide는 숨김(display:none)이 되기 때문
          shell.className = [...p.classList].filter((c) => !c.startsWith('slick')).join(' ');
          shell.style.cssText = 'display:block;margin:0;transform:none;width:auto;height:auto;opacity:1;visibility:visible;';
          inner.appendChild(shell);
          inner = shell;
        }
        const copy = el.cloneNode(true) as HTMLElement;
        copy.style.display = '';
        copy.style.visibility = 'visible';
        inner.appendChild(copy);
        document.body.appendChild(box);
        return true;
      },
      { key, maxWidth: TEXT_CAPTURE_MAX_WIDTH },
    );
    if (!ok) return null;
    const shot = await page.locator('#__refresh_cap').screenshot({ type: 'jpeg', quality: 70, scale: 'css', timeout: 5_000 });
    return shot.toString('base64');
  } catch {
    return null;
  } finally {
    await page.evaluate(() => document.getElementById('__refresh_cap')?.remove()).catch(() => {});
  }
}

/** 지연 로딩 그림까지 불러오도록 페이지를 끝까지 스크롤한다 */
async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 800) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
}

/** 열린 상세 페이지에서 제목·그림·연도 문장을 읽고 캡처한다 */
export async function extractDetail(page: Page): Promise<{ title: string; images: FoundImage[]; sentences: YearSentence[] }> {
  await scrollToBottom(page);
  const raw = await page.evaluate(readInPage, { maxYear: TARGET_MAX_YEAR, maxSide: IMAGE_CAPTURE_MAX_SIDE });
  const captures = new Map<string, string | null>();
  const sentences: YearSentence[] = [];
  for (const { captureKey, ...s } of raw.sentences) {
    if (captureKey !== null && !captures.has(captureKey) && captures.size < MAX_TEXT_CAPTURES) {
      captures.set(captureKey, await captureBlock(page, captureKey));
    }
    sentences.push({ ...s, capture: captureKey !== null ? (captures.get(captureKey) ?? null) : null });
  }
  return { title: raw.title, images: raw.images, sentences };
}
