'use client';

// 결과 화면 — 요약 숫자, 실패·확인 필요·경고 목록, 엑셀 다운로드 버튼 (DESIGN.md 8장, PLAN 작업 17)
// [엑셀 다운로드]는 onDownload에 연결된다(PLAN 작업 18~21). 없으면 버튼을 잠근다.

import type { RunOutcome } from '@/lib/run-steps';

interface ResultSummaryProps {
  outcome: RunOutcome;
  onDownload?: () => void;
  /** 엑셀을 만드는 중이면 버튼에 보여 줄 글자, 아니면 null */
  downloadLabel?: string | null;
}

export default function ResultSummary({ outcome, onDownload, downloadLabel = null }: ResultSummaryProps) {
  const { results, judgements, records, targets } = outcome;
  const fmt = (n: number) => n.toLocaleString('ko-KR');
  const failed = results.filter((r) => r.status !== '성공');
  const js = [...judgements.values()];
  const count = (v: string) => js.filter((j) => j.verdict === v).length;
  const unsure = js.filter((j) => j.verdict === '확인 필요');
  const imageRows = records.filter((r) => r.kind === '그림');
  const sentenceRows = records.filter((r) => r.kind === '문장');
  const noPath = new Set(imageRows.filter((r) => !r.homeLink).map((r) => r.src)).size;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-medium">검색 완료</p>
          <p className="text-sm text-zinc-500">{outcome.finishedAt.toLocaleString('ko-KR')}</p>
        </div>
        <button
          type="button"
          onClick={onDownload}
          disabled={!onDownload || downloadLabel !== null}
          aria-busy={downloadLabel !== null}
          className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
        >
          {downloadLabel ?? (onDownload ? '엑셀 다운로드' : '엑셀 다운로드 (준비 중)')}
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="검색한 페이지" value={`${fmt(results.length)}`} sub={failed.length > 0 ? `실패 ${fmt(failed.length)}` : '실패 0'} alert={failed.length > 0} />
        <Stat label="본문 그림" value={fmt(js.length)} sub={`연도 없음 ${fmt(count('연도 없음'))} · 대상 아님 ${fmt(count('대상 아님'))}`} />
        <Stat label="현행화 대상 그림" value={fmt(count('현행화 대상'))} sub={`확인 필요 ${fmt(unsure.length)}`} alert={unsure.length > 0} />
        <Stat label="수정 필요 문장" value={fmt(new Set(sentenceRows.map((r) => r.before)).size)} sub={`홈페이지 경로 없음 그림 ${fmt(noPath)}`} />
      </dl>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        엑셀 첫 번째 시트에는 그림·문장이 나오는 메뉴 위치마다 한 줄씩 {fmt(records.length)}줄(그림 {fmt(imageRows.length)} · 문장{' '}
        {fmt(sentenceRows.length)})이 들어가요.
      </p>

      {targets.warnings.length > 0 && (
        <List title={`메뉴 경고 ${targets.warnings.length}건`} items={targets.warnings} tone="amber" />
      )}
      {failed.length > 0 && (
        <List
          title={`수집하지 못한 페이지 ${failed.length}개`}
          items={failed.map((r) => `${r.target.title ?? r.target.openUrl} — ${r.error ?? r.status}`)}
          tone="red"
        />
      )}
      {unsure.length > 0 && (
        <List
          title={`AI가 판단하지 못한 그림(확인 필요) ${unsure.length}개`}
          items={unsure.map((j) => `${j.src.split('/').pop()} — ${j.error ?? '이유 없음'}`)}
          tone="amber"
        />
      )}
    </div>
  );
}

function Stat({ label, value, sub, alert = false }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      <dd className={`text-xs ${alert ? 'text-red-600' : 'text-zinc-500'}`}>{sub}</dd>
    </div>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone: 'red' | 'amber' }) {
  const color =
    tone === 'red' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  return (
    <details className={`rounded-md p-3 text-sm ${color}`}>
      <summary className="cursor-pointer font-medium">{title} 보기</summary>
      <ul className="mt-2 list-disc pl-5 text-zinc-700 dark:text-zinc-300">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
