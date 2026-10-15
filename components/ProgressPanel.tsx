'use client';

// 진행 화면 — 단계 3개(대상 찾기·페이지 수집·AI 판단)와 지금 단계의 진행률 (DESIGN.md 8장, PLAN 작업 17)

import type { RunProgress, RunStep } from '@/lib/run-steps';

const STEPS: { step: RunStep; help: string }[] = [
  { step: '대상 찾기', help: '메뉴를 읽어 검색할 상세 페이지 목록을 만들어요 (약 1분)' },
  { step: '페이지 수집', help: '상세 페이지를 1초 간격으로 하나씩 열어 그림·문장을 모아요 (약 5분)' },
  { step: 'AI 판단', help: '그림마다 AI가 그림 속 최고 연도를 읽어요 (약 3~5분)' },
];

export default function ProgressPanel({ progress }: { progress: RunProgress }) {
  const currentIndex = STEPS.findIndex((s) => s.step === progress.step);
  const percent = progress.total > 0 ? Math.floor((progress.done / progress.total) * 100) : null;

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-3">
        {STEPS.map((s, i) => {
          const state = i < currentIndex ? '끝' : i === currentIndex ? '진행 중' : '대기';
          return (
            <li key={s.step} className="flex flex-col gap-1">
              <p className={`font-medium ${state === '대기' ? 'text-zinc-400' : ''}`}>
                {state === '끝' ? '✔' : `${i + 1}.`} {s.step}
                {state === '진행 중' && progress.total > 0 && (
                  <span className="ml-2 font-normal tabular-nums" aria-live="polite">
                    {progress.done} / {progress.total}
                    {progress.problems > 0 && (
                      <span className="ml-2 text-red-600">
                        {s.step === 'AI 판단' ? '확인 필요' : '실패'} {progress.problems}
                      </span>
                    )}
                  </span>
                )}
              </p>
              {state === '진행 중' && (
                <>
                  <p className="text-sm text-zinc-500">{s.help}</p>
                  <Bar percent={percent} />
                </>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-zinc-500">ⓘ 창을 닫거나 새로고침하면 결과가 사라져요.</p>
    </div>
  );
}

/** 진행 막대. percent가 null이면 아직 전체 크기를 모르는 상태(움직이는 막대) */
function Bar({ percent }: { percent: number | null }) {
  return (
    <div
      role="progressbar"
      aria-label="진행률"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className="flex h-3 w-full items-center gap-3"
    >
      <div className="h-full flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full bg-blue-600 transition-all duration-500 ${percent === null ? 'w-1/4 animate-pulse' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {percent !== null && <span className="w-10 text-right text-sm tabular-nums">{percent}%</span>}
    </div>
  );
}
