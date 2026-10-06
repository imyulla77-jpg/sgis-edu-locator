'use client';

// 메인 화면 — 시작 → 수집 중 → 결과 상태 전환, 수집 지휘 (DESIGN.md 4장, PLAN 작업 16)
// 수집 중 화면(진행률)은 PLAN 작업 17, 결과 화면(요약·검색)은 작업 19에서 채운다.
// 지금은 두 상태를 간단한 글자로만 보여 준다.

import { useState } from 'react';
import StartForm from '@/components/StartForm';
import { collectAll } from '@/lib/collect-client';
import type { RunProgress } from '@/lib/run-batches';
import { SITE_UNAVAILABLE_MESSAGE } from '@/lib/site-check';
import type { PageResult } from '@/lib/types';

type Screen =
  | { kind: '시작' }
  | { kind: '수집 중'; progress: RunProgress | null }
  | { kind: '결과'; results: PageResult[]; totalPages: number }
  | { kind: '오류'; message: string };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: '시작' });

  const start = async (startUrl: string) => {
    setScreen({ kind: '수집 중', progress: null });
    try {
      const outcome = await collectAll(startUrl, {
        onProgress: (progress) => setScreen({ kind: '수집 중', progress }),
      });
      if (outcome.stoppedAsUnavailable) {
        setScreen({ kind: '오류', message: SITE_UNAVAILABLE_MESSAGE });
      } else {
        setScreen({ kind: '결과', results: outcome.results, totalPages: outcome.totalPages });
      }
    } catch (error) {
      // collect-client가 돌려주는 안내 문장은 화면에 그대로 보여 줘도 된다
      setScreen({ kind: '오류', message: error instanceof Error ? error.message : '수집 중 문제가 생겼어요' });
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">SGIS에듀 현행화 위치찾기</h1>
        <p className="text-zinc-600 dark:text-zinc-400">초등·중학·고교 공통 메뉴의 이미지·문구 위치를 찾아요</p>
      </header>

      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        {screen.kind === '시작' && <StartForm onStart={start} />}

        {/* 임시 표시 — PLAN 작업 17에서 진행률 화면(ProgressPanel)으로 바뀐다 */}
        {screen.kind === '수집 중' && (
          <p aria-live="polite">
            {screen.progress
              ? `수집 중… ${screen.progress.donePages} / ${screen.progress.totalPages} 페이지 · 실패 ${screen.progress.failedPages}건`
              : '메뉴를 읽는 중…'}
          </p>
        )}

        {/* 임시 표시 — PLAN 작업 19에서 결과 화면(요약·검색)으로 바뀐다 */}
        {screen.kind === '결과' && (
          <p>
            수집 완료 · {screen.totalPages}페이지 · 성공 {screen.results.filter((r) => r.status === '성공').length} · 실패{' '}
            {screen.results.filter((r) => r.status !== '성공').length}
          </p>
        )}

        {screen.kind === '오류' && (
          <div role="alert" className="flex flex-col gap-4">
            <p className="font-medium text-red-600">⚠ {screen.message}</p>
            <button
              type="button"
              onClick={() => setScreen({ kind: '시작' })}
              className="self-start rounded-md border border-zinc-300 px-4 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              처음으로
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
