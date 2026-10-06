'use client';

// 수집 중 화면 — 진행률·지금 묶음·과정별 현황·실패 수 (DESIGN.md 4.2장, PLAN 작업 17)

import type { RunProgress } from '@/lib/run-batches';

interface ProgressPanelProps {
  /** 아직 묶음 목록을 받기 전(메뉴 읽는 중)이면 null */
  progress: RunProgress | null;
}

export default function ProgressPanel({ progress }: ProgressPanelProps) {
  if (!progress) {
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="font-medium">메뉴를 읽는 중…</p>
        <p className="text-sm text-zinc-500">초등·중학·고교 메인을 열어 수집할 페이지 목록을 만들고 있어요 (약 20초)</p>
        <Bar percent={null} />
      </div>
    );
  }

  const { donePages, totalPages, failedPages, current, currentPages, courses } = progress;
  const percent = totalPages > 0 ? Math.floor((donePages / totalPages) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="font-medium" aria-live="polite">
        수집 중… {donePages} / {totalPages} 페이지
      </p>

      <Bar percent={percent} />

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        지금: {current} ({currentPages}페이지)
      </p>

      <dl className="grid grid-cols-[4rem_1fr] gap-y-2 text-sm">
        <dt className="text-zinc-500">과정별</dt>
        <dd className="flex flex-wrap gap-x-5 gap-y-1">
          {courses.map((c) => {
            const finished = c.totalPages > 0 && c.donePages >= c.totalPages;
            return (
              <span key={c.course} className={finished ? 'text-green-700 dark:text-green-400' : undefined}>
                {c.course} {c.donePages}/{c.totalPages}
                {finished && ' ✔'}
              </span>
            );
          })}
        </dd>
        <dt className="text-zinc-500">실패</dt>
        <dd className={failedPages > 0 ? 'font-medium text-red-600' : undefined}>{failedPages}건</dd>
      </dl>

      <p className="text-sm text-zinc-500">ⓘ 창을 닫거나 새로고침하면 수집 결과가 사라져요.</p>
    </div>
  );
}

/** 진행 막대. percent가 null이면 아직 전체 크기를 모르는 상태(움직이는 막대) */
function Bar({ percent }: { percent: number | null }) {
  return (
    <div
      role="progressbar"
      aria-label="수집 진행률"
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
