'use client';

// 지난 수집 결과와 비교 — 지난 엑셀 올리기, 새로 생김·사라짐 요약과 목록 (PRD nice 1, PLAN 작업 27, DESIGN.md 17장)

import { useState, type ChangeEvent } from 'react';
import { compareWithPast, type Comparison } from '@/lib/compare';
import type { Group } from '@/lib/types';

/** 올릴 수 있는 지난 엑셀 크기 한도 (엑셀 한도 20MB + 여유) */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

interface PastCompareProps {
  groups: Group[];
  /** 이번 수집을 일부 메뉴만 했는지 */
  partial: boolean;
  comparison?: Comparison;
  onCompared: (comparison: Comparison | undefined) => void;
}

export default function PastCompare({ groups, partial, comparison, onCompared }: PastCompareProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // 같은 파일을 다시 골라도 동작하도록
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('파일이 너무 커요. 이 앱이 만든 엑셀을 올려 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { readPastResult } = await import('@/lib/past-result'); // 이때 엑셀 도구를 불러온다
      const past = await readPastResult(await file.arrayBuffer(), file.name);
      onCompared(compareWithPast(groups, past, partial));
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 읽지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-medium">지난 결과와 비교</p>
          <p className="text-zinc-600 dark:text-zinc-400">
            지난번에 받은 엑셀(SGIS에듀_공통위치_날짜.xlsx)을 올리면 새로 생기거나 사라진 그림·문구를 보여 줘요.
          </p>
        </div>
        <label
          className={`cursor-pointer rounded-md border border-zinc-300 bg-white px-4 py-2 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800 ${busy ? 'pointer-events-none opacity-60' : ''}`}
        >
          {busy ? '읽는 중…' : comparison ? '다른 파일과 비교' : '지난 결과 엑셀 올리기'}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFile}
            disabled={busy}
            className="sr-only"
            aria-label="지난 결과 엑셀 올리기"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-red-600">
          ⚠ {error}
        </p>
      )}

      {comparison && (
        <div className="flex flex-col gap-2" role="status">
          <p>
            <span className="font-medium">{comparison.past.collectedAt || '날짜 모름'}</span> 조사(
            {comparison.past.fileName})와 비교:{' '}
            <span className="font-medium text-green-700 dark:text-green-400">새로 생김 {comparison.addedIds.length}</span> ·{' '}
            <span className="font-medium text-red-700 dark:text-red-400">사라짐 {comparison.removed.length}</span>
          </p>
          <p className="text-zinc-500">
            새로 생긴 항목은 아래 검색의 “변화” 필터로 볼 수 있어요. 엑셀을 받으면 요약 시트와 안내 시트에도 적혀요.
          </p>
          {!comparison.past.hasKeys && (
            <p className="text-amber-700 dark:text-amber-400">
              ⓘ 지난 파일에 비교 기준이 없어 그림은 주소로 비교했어요. 파일 이름만 바뀐 같은 그림은 새로 생김·사라짐으로 보일 수 있어요.
            </p>
          )}
          {comparison.partial && (
            <p className="text-amber-700 dark:text-amber-400">
              ⓘ 이번이나 지난번에 일부 메뉴만 수집해서 “사라짐”이 정확하지 않을 수 있어요.
            </p>
          )}
          {comparison.removed.length > 0 && (
            <details>
              <summary className="cursor-pointer text-red-700 dark:text-red-400">
                사라진 항목 {comparison.removed.length}개 보기
              </summary>
              <ul className="mt-2 max-h-64 list-disc overflow-y-auto pl-5">
                {comparison.removed.map((item) => (
                  <li key={item.key}>
                    [{item.kind}] {item.display}
                    {item.courses && <span className="text-zinc-500"> ({item.courses})</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button type="button" onClick={() => onCompared(undefined)} className="self-start text-xs text-zinc-600 underline">
            비교 지우기
          </button>
        </div>
      )}
    </div>
  );
}
