'use client';

// 시작 화면 — 시작 주소 입력·검사, 수집 시작 (DESIGN.md 4.1장, PLAN 작업 16)

import { useState, type FormEvent } from 'react';
import { DEFAULT_START_URL, isAllowedUrl, URL_ERROR_MESSAGE } from '@/lib/url';

interface StartFormProps {
  /** 주소 검사를 통과하면 정리한 주소로 불린다 */
  onStart: (startUrl: string) => void;
}

export default function StartForm({ onStart }: StartFormProps) {
  const [url, setUrl] = useState(DEFAULT_START_URL);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 다른 사이트 주소면 수집을 시작하지 않고 입력칸 아래에 안내한다(PRD must 1)
    if (!isAllowedUrl(url)) {
      setError(URL_ERROR_MESSAGE);
      return;
    }
    setError(null);
    onStart(url.trim());
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

      <button
        type="submit"
        className="self-end rounded-md bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        수집 시작
      </button>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        ⓘ 약 5~10분 걸려요. 창을 닫으면 수집 결과가 사라져요.
      </p>
    </form>
  );
}
