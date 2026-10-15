// [서버 전용] 그림 속 최고 연도를 Claude AI로 읽고 현행화 대상인지 판정한다 (DESIGN.md 4장, PLAN 작업 9·10)
// - 그림 파일을 서버가 받아(10초 제한) 지문(sha256)을 만들고, base64로 Claude에 보낸다
// - AI에게는 "그림에 적힌 4자리 연도"만 묻는다. 답 형식은 구조화 출력(JSON 스키마)으로 고정한다
// - 판정(현행화 대상/대상 아님/연도 없음/확인 필요)은 AI가 아니라 이 파일의 decideVerdict가 정한다
// - AI가 거절하면 Anthropic이 고른 대체 모델이 서버 쪽에서 다시 답하게 한다(fallbacks: "default")
// - 키(ANTHROPIC_API_KEY)는 SDK가 환경변수에서 읽는다. 키·그림 내용은 로그에 남기지 않는다
//
// scripts/에서도 불러오므로 lib 파일은 상대 경로 + .ts 확장자로 불러온다(CLAUDE.md 5장).

import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { Judgement, Verdict } from './refresh-types.ts';
import { TARGET_MAX_YEAR } from './refresh-types.ts';
import { isAllowedUrl } from './url.ts';

/** 연도를 읽는 모델 (담당자 결정 2026-10-15) */
export const JUDGE_MODEL = 'claude-opus-5-5';

/** 생각 깊이. 단순 판독이라 낮게 두고, 20개 대조에서 틀리면 medium으로 올린다(DESIGN.md 4장) */
const JUDGE_EFFORT = 'low' as const;

/** 대체 모델 기능의 beta 이름 ("default" 형식용) */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** 그림 파일을 받을 때 기다리는 최대 시간 */
const IMAGE_TIMEOUT_MS = 10_000;

/** Claude에 보낼 수 있는 그림 크기 한도(5MB)보다 조금 작게 */
const MAX_IMAGE_BYTES = 4_500_000;

/** AI 판단을 맡길 수 있는 그림 주소: SGIS에듀 콘텐츠 그림만 (아무 그림이나 AI에 보내지 않게, CHECK.md SEC-006) */
export function isJudgeableImage(url: string): boolean {
  if (!isAllowedUrl(url)) return false;
  const path = new URL(url.trim()).pathname;
  return /^\/sgis_edu\/resource\/images\/contents\/[A-Za-z0-9_/.-]+\.(png|jpe?g|gif|webp)$/i.test(path);
}

/** AI 답의 모양 */
export interface YearReading {
  years: number[];
  maxYear: number | null;
  status: '연도 있음' | '연도 없음' | '판독 불가';
}

/** 구조화 출력 스키마 */
const READING_SCHEMA = {
  type: 'object',
  properties: {
    years: { type: 'array', items: { type: 'integer' }, description: '그림에 글자로 적힌 4자리 연도 전부(중복 없이)' },
    maxYear: { type: ['integer', 'null'], description: 'years 중 가장 큰 값. 연도가 없거나 읽을 수 없으면 null' },
    status: { type: 'string', enum: ['연도 있음', '연도 없음', '판독 불가'] },
  },
  required: ['years', 'maxYear', 'status'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'You read years printed in statistical charts, maps and screenshots used in Korean school lessons.',
  'Find every 4-digit year (1900-2099) that is visibly written in the image: titles, axis labels, legends, captions, tabs, sources and notes.',
  'Count a year only if you can actually read its digits. Do not infer years from context or guess partially hidden digits.',
  'Treat ranges like "2010~2020" as two years. Ignore numbers that are not years (populations, percentages, codes).',
  'status: "연도 있음" if at least one year is clearly readable, "연도 없음" if the image has no years, "판독 불가" if text that may contain a year is too small or blurry to read with certainty.',
].join(' ');

/** AI 답과 기준 연도로 판정한다. AI 답이 앞뒤가 맞지 않으면 "확인 필요" */
export function decideVerdict(reading: YearReading, maxAllowed = TARGET_MAX_YEAR): { verdict: Verdict; error?: string } {
  if (reading.status === '판독 불가') return { verdict: '확인 필요', error: 'AI가 그림 속 글자를 확실히 읽지 못함' };
  if (reading.status === '연도 없음') {
    if (reading.years.length > 0) return { verdict: '확인 필요', error: 'AI 답이 앞뒤가 맞지 않음(연도 없음인데 연도 목록이 있음)' };
    return { verdict: '연도 없음' };
  }
  const valid = reading.years.filter((y) => Number.isInteger(y) && y >= 1900 && y <= 2099);
  // 1900년보다 이른 연도만 있으면(예: 1866년 옛 지도 설명) 역사 자료일 수 있어 사람이 보게 한다
  if (valid.length === 0 && reading.years.some((y) => Number.isInteger(y) && y >= 1000 && y < 1900)) {
    return { verdict: '확인 필요', error: `1900년 이전 연도만 있음(${reading.years.join('·')}) — 역사 자료일 수 있음` };
  }
  if (valid.length === 0 || reading.maxYear === null) return { verdict: '확인 필요', error: 'AI 답이 앞뒤가 맞지 않음(연도 있음인데 연도가 없음)' };
  if (Math.max(...valid) !== reading.maxYear) return { verdict: '확인 필요', error: 'AI 답이 앞뒤가 맞지 않음(최고 연도 불일치)' };
  return { verdict: reading.maxYear <= maxAllowed ? '현행화 대상' : '대상 아님' };
}

/** 그림 파일을 받는다. 다른 주소로 넘겨주는 응답은 따라가지 않는다 */
async function downloadImage(url: string): Promise<{ bytes: Buffer; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }> {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`그림 응답 오류(${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error('빈 그림');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('그림이 너무 큼');
  // 파일 첫 부분으로 종류를 정한다(주소 확장자보다 정확)
  const head = bytes.subarray(0, 12);
  const mediaType =
    head[0] === 0x89 && head[1] === 0x50 ? 'image/png'
    : head[0] === 0xff && head[1] === 0xd8 ? 'image/jpeg'
    : head.subarray(0, 3).toString('latin1') === 'GIF' ? 'image/gif'
    : head.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp'
    : null;
  if (!mediaType) throw new Error('그림 형식을 알 수 없음');
  return { bytes, mediaType };
}

let client: Anthropic | null = null;
/** SDK 클라이언트 (키는 ANTHROPIC_API_KEY 환경변수에서 읽음) */
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** Claude에 그림을 보내 연도를 읽는다. 거절·형식 오류는 Error로 던진다 */
async function readYears(
  bytes: Buffer,
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
): Promise<{ reading: YearReading; model: string; usage: { inputTokens: number; outputTokens: number } }> {
  const response = await getClient().beta.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 4000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { effort: JUDGE_EFFORT, format: { type: 'json_schema', schema: READING_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') } },
          { type: 'text', text: 'List the 4-digit years written in this image.' },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') throw new Error('AI가 답하지 않음(거절)');
  if (response.stop_reason === 'max_tokens') throw new Error('AI 답이 중간에 끊김');
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('AI 답이 비어 있음');
  const parsed = JSON.parse(text.text) as Partial<YearReading>;
  if (!Array.isArray(parsed.years) || !('maxYear' in parsed) || !['연도 있음', '연도 없음', '판독 불가'].includes(parsed.status as string)) {
    throw new Error('AI 답 형식이 맞지 않음');
  }
  const years = [...new Set(parsed.years.map(Number))].sort((a, b) => a - b);
  return {
    reading: { years, maxYear: parsed.maxYear ?? null, status: parsed.status as YearReading['status'] },
    model: response.model,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

/** AI 요청이 많아 거절됐는지 (화면이 잠시 쉬었다 다시 보내게 429로 알림) */
export class JudgeBusyError extends Error {
  constructor() {
    super('AI 요청이 많아요. 잠시 뒤 다시 시도하세요');
    this.name = 'JudgeBusyError';
  }
}

/**
 * 그림 하나를 판단한다. 그림을 못 받거나 AI가 답하지 못하면 "확인 필요"로 돌려준다(값을 지어내지 않음).
 * AI 요청 한도에 걸리면(SDK가 2번 다시 시도한 뒤에도) JudgeBusyError를 던진다.
 */
export async function judgeImage(src: string): Promise<Judgement> {
  const base: Judgement = { src, sha256: null, years: [], maxYear: null, verdict: '확인 필요', model: null };
  if (!isJudgeableImage(src)) return { ...base, error: 'SGIS에듀 콘텐츠 그림이 아님' };

  let image: Awaited<ReturnType<typeof downloadImage>>;
  try {
    image = await downloadImage(src);
  } catch (error) {
    return { ...base, error: `그림을 받지 못함(${error instanceof Error ? error.message : '알 수 없음'})` };
  }
  const sha256 = createHash('sha256').update(image.bytes).digest('hex');
  // 키가 없으면(배포본에 아직 안 넣음 등) AI를 부르지 않는다
  if (!process.env.ANTHROPIC_API_KEY) return { ...base, sha256, error: 'AI 키가 설정되지 않음(ANTHROPIC_API_KEY)' };

  try {
    const { reading, model, usage } = await readYears(image.bytes, image.mediaType);
    const { verdict, error } = decideVerdict(reading);
    return { src, sha256, years: reading.years, maxYear: reading.maxYear, verdict, model, usage, error };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new JudgeBusyError();
    if (error instanceof Anthropic.AuthenticationError) return { ...base, sha256, error: 'AI 키가 맞지 않음(ANTHROPIC_API_KEY 확인)' };
    if (error instanceof Anthropic.APIError) return { ...base, sha256, error: `AI 요청 오류(${error.status ?? '연결'})` };
    if (error instanceof SyntaxError) return { ...base, sha256, error: 'AI 답을 읽지 못함' };
    return { ...base, sha256, error: error instanceof Error ? error.message : 'AI 판단 중 문제' };
  }
}
