'use client';

// 메뉴 고르기 화면 — 사이트에서 읽은 상단 메뉴를 골라 일부만 수집 (PRD nice 3, PLAN 작업 25, DESIGN.md 15장)
// 고른 메뉴는 초등·중학·고교 세 과정 모두에서 수집한다.

import { useMemo, useState } from 'react';
import { listMenuGroups } from '@/lib/menu-select';
import type { Batch } from '@/lib/types';
import { COURSES } from '@/lib/types';

interface MenuPickerProps {
  batches: Batch[];
  /** 고른 상단 메뉴 이름들로 수집을 시작한다 */
  onPick: (menus: string[]) => void;
  onCancel: () => void;
}

/** 페이지당 평균 걸리는 시간(초) — 전체 58페이지 약 7분 실측으로 어림 */
const SECONDS_PER_PAGE = 7;

export default function MenuPicker({ batches, onPick, onCancel }: MenuPickerProps) {
  const groups = useMemo(() => listMenuGroups(batches), [batches]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const pages = groups.filter((g) => selected.has(g.name)).reduce((sum, g) => sum + g.pages, 0);
  const minutes = Math.max(1, Math.round((pages * SECONDS_PER_PAGE) / 60));
  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-medium">수집할 메뉴를 고르세요</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          고른 메뉴는 초등·중학·고교 세 과정 모두에서 수집해요. 메뉴 목록은 방금 사이트에서 읽어 온 것이에요.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">상단 메뉴</legend>
        {groups.map((g) => (
          <label
            key={g.name}
            className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <input
              type="checkbox"
              aria-label={`${g.name} ${g.pages}페이지`}
              checked={selected.has(g.name)}
              onChange={() => toggle(g.name)}
            />
            <span className="flex-1 font-medium">{g.name}</span>
            <span className="text-sm text-zinc-500">
              {g.pages}페이지 ({COURSES.map((c) => `${c.slice(0, 1)} ${g.byCourse[c]}`).join(' · ')})
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" role="status">
          {selected.size === 0 ? '메뉴를 1개 이상 고르세요' : `${selected.size}개 메뉴 · ${pages}페이지 · 약 ${minutes}분`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 px-4 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            처음으로
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => onPick(groups.map((g) => g.name).filter((n) => selected.has(n)))}
            className="rounded-md bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
          >
            고른 메뉴 수집
          </button>
        </div>
      </div>
    </div>
  );
}
