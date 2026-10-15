'use client';

// 시작 화면 — 시작 주소 입력·검사, (배포본에서만) 실행 비밀번호, 검색 시작 (DESIGN.md 8장, PLAN 작업 16)

import { useState, type FormEvent } from 'react';
import { DEFAULT_START_URL, isAllowedUrl, URL_ERROR_MESSAGE } from '@/lib/url';

interface StartFormProps {
  /** 주소 검사를 통과하면 정리한 주소와 비밀번호로 불린다 */
  onStart: (startUrl: string, password: string) => void;
  /** 서버가 실행 비밀번호를 요구했으면 true (비밀번호 칸을 보인다) */
  askPassword: boolean;
  /** 비밀번호가 틀렸다는 등 시작 화면에 보여 줄 안내 */
  notice?: string | null;
  /** 직전에 쓴 주소 (다시 시작할 때 그대로 채움) */
  initialUrl?: string;
}

export default function StartForm({ onStart, askPassword, notice = null, initialUrl = DEFAULT_START_URL }: StartFormProps) {
  const [url, setUrl] = useState(initialUrl);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 다른 사이트 주소면 시작하지 않고 입력칸 아래에 안내한다(PRD must 1)
    if (!isAllowedUrl(url)) {
      setError(URL_ERROR_MESSAGE);
      return;
    }
    if (askPassword && !password) {
      setError('실행 비밀번호를 넣어 주세요');
      return;
    }
    setError(null);
    onStart(url.trim(), password);
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
        aria-invalid={error === URL_ERROR_MESSAGE ? true : undefined}
        aria-describedby="start-url-help"
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-300 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <p id="start-url-help" className="text-sm text-zinc-500">
        보통은 그대로 두면 돼요. 사이트 주소가 바뀌었을 때만 고치세요.
      </p>

      {askPassword && (
        <>
          <label htmlFor="run-password" className="text-sm font-medium">
            실행 비밀번호
          </label>
          <input
            id="run-password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <p className="text-sm text-zinc-500">인터넷 배포 주소에서는 AI 요금 보호를 위해 비밀번호가 필요해요. 담당자에게 받으세요.</p>
        </>
      )}

      {(error || notice) && (
        <p role="alert" className="text-sm text-red-600">
          ⚠ {error ?? notice}
        </p>
      )}

      <button
        type="submit"
        className="self-end rounded-md bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        검색 시작
      </button>

      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        <li>초등·중학·고교의 검색 대상 메뉴 아래 상세 페이지(약 40개)를 열어 그림과 문장을 모으고, AI가 그림 속 최고 연도를 읽어요.</li>
        <li>약 10분 걸려요. AI 사용 요금이 한 번에 약 1~2달러 생겨요.</li>
        <li>창을 닫거나 새로고침하면 결과가 사라져요.</li>
      </ul>
    </form>
  );
}
