'use client';

// 시작 화면 — 시작 주소 입력·검사, 수집 방법 선택, 수집 시작 (DESIGN.md 4.1·15장, PLAN 작업 16·25)

import { useState, type FormEvent } from 'react';
import { DEFAULT_START_URL, isAllowedUrl, URL_ERROR_MESSAGE } from '@/lib/url';

/** 수집 방법: 전체 수집 / 메뉴를 읽은 뒤 골라서 수집 (PLAN 작업 25) */
export type CollectMode = '전체' | '메뉴 고르기';

interface StartFormProps {
  /** 주소 검사를 통과하면 정리한 주소와 수집 방법으로 불린다 */
  onStart: (startUrl: string, mode: CollectMode) => void;
}

export default function StartForm({ onStart }: StartFormProps) {
  const [url, setUrl] = useState(DEFAULT_START_URL);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<CollectMode>('전체');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 다른 사이트 주소면 수집을 시작하지 않고 입력칸 아래에 안내한다(PRD must 1)
    if (!isAllowedUrl(url)) {
      setError(URL_ERROR_MESSAGE);
      return;
    }
    setError(null);
    onStart(url.trim(), mode);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <label htmlFor="start-url" className="text-sm font-medium">
        시작 주소
      </label>
      <input
        id="start-url"
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          if (error) setError(null); // 고치기 시작하면 안내를 지운다
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'start-url-error' : 'start-url-help'}
        className={`w-full rounded-md border px-3 py-2 font-mono text-sm outline-none focus:ring-2 ${
          error ? 'border-red-500 focus:ring-red-300' : 'border-zinc-300 focus:ring-blue-300 dark:border-zinc-700'
        } bg-white dark:bg-zinc-900`}
      />
      {error ? (
        <p id="start-url-error" role="alert" className="text-sm text-red-600">
          ⚠ {error}
        </p>
      ) : (
        <p id="start-url-help" className="text-sm text-zinc-500">
          보통은 그대로 두면 돼요. 사이트 주소가 바뀌었을 때만 고치세요.
        </p>
      )}

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">수집 방법</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="mode"
            aria-label="전체 수집"
            checked={mode === '전체'}
            onChange={() => setMode('전체')}
            className="mt-1"
          />
          <span>
            전체 수집 <span className="text-zinc-500">(추천 · 공통 메뉴 전부, 약 7분)</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="mode"
            aria-label="메뉴 골라서 수집"
            checked={mode === '메뉴 고르기'}
            onChange={() => setMode('메뉴 고르기')}
            className="mt-1"
          />
          <span>
            메뉴 골라서 수집 <span className="text-zinc-500">(메뉴를 읽은 뒤 고른 메뉴만, 세 과정 모두)</span>
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        className="self-end rounded-md bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        {mode === '전체' ? '수집 시작' : '메뉴 읽기'}
      </button>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        ⓘ {mode === '전체' ? '약 5~10분 걸려요.' : '메뉴를 읽는 데 약 20초 걸려요.'} 창을 닫으면 수집 결과가 사라져요.
      </p>
    </form>
  );
}
