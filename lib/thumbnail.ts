// [화면] 엑셀 미리보기용 작은 그림 만들기 (PRD nice 2, PLAN 작업 26, DESIGN.md 16장)
// 그림을 우리 서버(/api/image)를 거쳐 받아, 브라우저 안에서 긴 변 60픽셀 PNG로 줄인다.
// 움직이는 그림(gif)은 첫 장면, 받지 못하거나 그릴 수 없는 그림은 null(엑셀에 "미리보기 없음").

/** 미리보기 그림의 긴 변 (담당자 결정: 60픽셀) */
export const THUMBNAIL_MAX_SIDE = 60;

/** 한 번에 받는 그림 수 (사이트 부담을 줄이려고 적게) */
const CONCURRENCY = 3;

export interface Thumbnail {
  /** PNG 파일 내용 */
  bytes: ArrayBuffer;
  width: number;
  height: number;
}

/** 그림 파일(blob)을 화면에 그릴 수 있는 모양으로 읽는다. createImageBitmap이 못 읽는 그림(SVG 등)은 <img>로 읽는다 */
async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  try {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
  } catch {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(objectUrl) };
  }
}

/** 그림 하나를 긴 변 60픽셀 PNG로 줄인다. 실패하면 null */
export async function makeThumbnail(imageUrl: string): Promise<Thumbnail | null> {
  try {
    const response = await fetch(`/api/image?url=${encodeURIComponent(imageUrl)}`);
    if (!response.ok) return null;
    const image = await decode(await response.blob());
    try {
      if (!image.width || !image.height) return null;
      const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(image.source, 0, 0, width, height);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      return png ? { bytes: await png.arrayBuffer(), width, height } : null;
    } finally {
      image.done();
    }
  } catch {
    return null;
  }
}

/**
 * 여러 그림의 미리보기를 만든다. 한 번에 3개씩 받는다.
 * 결과: 그림 주소 → 미리보기(실패면 null). onProgress로 몇 개 끝났는지 알린다.
 */
export async function makeThumbnails(
  imageUrls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, Thumbnail | null>> {
  const unique = [...new Set(imageUrls)];
  const result = new Map<string, Thumbnail | null>();
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const url = unique[next++];
      result.set(url, await makeThumbnail(url));
      onProgress?.(result.size, unique.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return result;
}
