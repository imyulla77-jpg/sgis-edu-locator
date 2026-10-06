'use client';

// 메인 화면 — 시작 → 수집 중 → 결과 상태 전환, 수집 지휘 (DESIGN.md 4장, PLAN 작업 16·17·18·19)

import { useEffect, useState } from 'react';
import ProgressPanel from '@/components/ProgressPanel';
import ResultSearch from '@/components/ResultSearch';
import ResultSummary from '@/components/ResultSummary';
import StartForm from '@/components/StartForm';
import { collectAll } from '@/lib/collect-client';
import { buildGroups } from '@/lib/group';
import type { RunProgress } from '@/lib/run-batches';
import { SITE_UNAVAILABLE_MESSAGE } from '@/lib/site-check';
import type { Group, PageResult } from '@/lib/types';

type Screen =
  | { kind: '시작' }
  | { kind: '수집 중'; progress: RunProgress | null }
  | { kind: '결과'; results: PageResult[]; totalPages: number; groups: Group[] }
  | { kind: '오류'; message: string };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: '시작' });

  // 수집 중·결과 화면에서 창을 닫거나 새로고침하려 하면 브라우저 기본 경고창을 띄운다 (PRD Q7, DESIGN.md 9장)
  // 결과는 브라우저 메모리에만 있어서 창을 닫으면 사라지기 때문.
  // 최신 브라우저는 경고창에 직접 정한 문구를 보여 주지 않으므로 문구는 브라우저가 정한다.
  const mustWarn = screen.kind === '수집 중' || screen.kind === '결과';
  useEffect(() => {
    if (!mustWarn) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ''; // 오래된 브라우저에서도 경고창이 뜨도록
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [mustWarn]);

  const start = async (startUrl: string) => {
    setScreen({ kind: '수집 중', progress: null });
    try {
      const outcome = await collectAll(startUrl, {
        onProgress: (progress) => setScreen({ kind: '수집 중', progress }),
      });
      if (outcome.stoppedAsUnavailable) {
        setScreen({ kind: '오류', message: SITE_UNAVAILABLE_MESSAGE });
      } else {
        // 같은 항목 묶기·공통ID는 브라우저 안에서 한 번만 계산한다(DESIGN.md 5장 ④)
        const groups = buildGroups(outcome.results);
        setScreen({ kind: '결과', results: outcome.results, totalPages: outcome.totalPages, groups });
      }
    } catch (error) {
      // collect-client가 돌려주는 안내 문장은 화면에 그대로 보여 줘도 된다
      setScreen({ kind: '오류', message: error instanceof Error ? error.message : '수집 중 문제가 생겼어요' });
    }
  };

  // [다시 수집]: 지금 결과를 지우고 시작 화면으로. 되돌릴 수 없으니 먼저 확인한다(DESIGN.md 4.3장)
  const recollect = () => {
    if (window.confirm('지금 수집 결과가 사라져요. 다시 수집할까요?')) setScreen({ kind: '시작' });
  };

  return (
    <main
      className={`mx-auto flex w-full flex-1 flex-col gap-8 px-6 py-12 ${screen.kind === '결과' ? 'max-w-6xl' : 'max-w-3xl'}`}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">SGIS에듀 현행화 위치찾기</h1>
        <p className="text-zinc-600 dark:text-zinc-400">초등·중학·고교 공통 메뉴의 이미지·문구 위치를 찾아요</p>
      </header>

      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        {screen.kind === '시작' && <StartForm onStart={start} />}

        {screen.kind === '수집 중' && <ProgressPanel progress={screen.progress} />}

        {screen.kind === '결과' && (
          <div className="flex flex-col gap-6">
            <ResultSummary results={screen.results} totalPages={screen.totalPages} groups={screen.groups} />
            <hr className="border-zinc-200 dark:border-zinc-800" />
            <ResultSearch groups={screen.groups} />
            <button
              type="button"
              onClick={recollect}
              className="self-end rounded-md border border-zinc-300 px-4 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              다시 수집
            </button>
          </div>
        )}

        {/* 처음 3페이지 연속 실패·메뉴 읽기 실패 등: 진행 영역이 빨간 안내와 [처음으로]로 바뀐다(DESIGN.md 4.2장) */}
        {screen.kind === '오류' && (
          <div role="alert" className="flex flex-col gap-4 rounded-md bg-red-50 p-4 dark:bg-red-950/40">
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
