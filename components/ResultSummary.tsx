'use client';

// 결과 요약 — 페이지·실패·항목 수, 공통 범위별 개수, 엑셀 다운로드 버튼 (DESIGN.md 4.3장, PLAN 작업 19)
// [엑셀 다운로드]는 onDownload에 연결된다(PLAN 작업 23). 엑셀을 만드는 동안은 버튼을 잠근다.

import type { Group, PageResult } from '@/lib/types';
import { COURSES } from '@/lib/types';

interface ResultSummaryProps {
  results: PageResult[];
  totalPages: number;
  groups: Group[];
  onDownload?: () => void;
  /** 엑셀을 만드는 중이면 true */
  downloading?: boolean;
}

export default function ResultSummary({ results, totalPages, groups, onDownload, downloading = false }: ResultSummaryProps) {
  const failed = results.filter((r) => r.status !== '성공');
  const byCourses = (n: number) => groups.filter((g) => g.courses.length === n).length;
  const fmt = (n: number) => n.toLocaleString('ko-KR');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-medium">
            수집 완료 · {fmt(totalPages)}페이지 ·{' '}
            <span className={failed.length > 0 ? 'text-red-600' : undefined}>실패 {fmt(failed.length)}건</span> · 항목{' '}
            {fmt(groups.length)}개
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            3과정 공통 {fmt(byCourses(COURSES.length))} · 2과정 공통 {fmt(byCourses(2))} · 한 과정만 {fmt(byCourses(1))}
          </p>
        </div>
        <button
          type="button"
          onClick={onDownload}
          disabled={!onDownload || downloading}
          aria-busy={downloading}
          className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
        >
          {downloading ? '엑셀 만드는 중…' : '엑셀 다운로드'}
        </button>
      </div>

      {failed.length > 0 && (
        <details className="rounded-md bg-red-50 p-3 text-sm dark:bg-red-950/40">
          <summary className="cursor-pointer font-medium text-red-700 dark:text-red-400">
            수집하지 못한 페이지 {failed.length}개 보기
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {failed.map((r) => (
              <li key={`${r.target.course}-${r.target.url}`}>
                {r.target.course} {r.target.menu} — {r.error ?? r.status}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
