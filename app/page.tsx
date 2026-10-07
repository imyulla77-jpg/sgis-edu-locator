'use client';

// 메인 화면 — 시작 → (메뉴 선택) → 수집 중 → 결과 상태 전환, 수집 지휘, 엑셀 다운로드
// (DESIGN.md 4·15장, PLAN 작업 16~19·23·25)

import { useEffect, useState } from 'react';
import MenuPicker from '@/components/MenuPicker';
import ProgressPanel from '@/components/ProgressPanel';
import ResultSearch from '@/components/ResultSearch';
import ResultSummary from '@/components/ResultSummary';
import StartForm, { type CollectMode } from '@/components/StartForm';
import { collectBatches, fetchBatches } from '@/lib/collect-client';
import { downloadExcel } from '@/lib/download';
import { buildGroups } from '@/lib/group';
import { pickBatches } from '@/lib/menu-select';
import type { RunProgress } from '@/lib/run-batches';
import { SITE_UNAVAILABLE_MESSAGE } from '@/lib/site-check';
import type { Batch, Group, PageResult } from '@/lib/types';

type Screen =
  | { kind: '시작' }
  | { kind: '메뉴 선택'; startUrl: string; batches: Batch[] }
  | { kind: '수집 중'; progress: RunProgress | null }
  | {
      kind: '결과';
      results: PageResult[];
      totalPages: number;
      groups: Group[];
      /** 엑셀 "안내" 시트에 적을 시작 주소와 수집을 마친 시각 */
      startUrl: string;
      collectedAt: Date;
      /** 메뉴를 골라 수집했으면 고른 상단 메뉴, 전체 수집이면 없음 */
      menus?: string[];
    }
  | { kind: '오류'; message: string };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: '시작' });
  /** 엑셀을 받는 중이면 버튼에 보여 줄 진행 글자, 아니면 null */
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);

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

  // collect-client가 돌려주는 안내 문장은 화면에 그대로 보여 줘도 된다
  const showError = (error: unknown) =>
    setScreen({ kind: '오류', message: error instanceof Error ? error.message : '수집 중 문제가 생겼어요' });

  // 묶음 목록(전체 또는 고른 메뉴만)을 차례로 수집하고 결과 화면으로
  const run = async (startUrl: string, batches: Batch[], menus?: string[]) => {
    setScreen({ kind: '수집 중', progress: null });
    try {
      const outcome = await collectBatches(batches, {
        onProgress: (progress) => setScreen({ kind: '수집 중', progress }),
      });
      if (outcome.stoppedAsUnavailable) {
        setScreen({ kind: '오류', message: SITE_UNAVAILABLE_MESSAGE });
        return;
      }
      // 같은 항목 묶기·공통ID는 브라우저 안에서 한 번만 계산한다(DESIGN.md 5장 ④)
      const groups = buildGroups(outcome.results);
      setScreen({
        kind: '결과',
        results: outcome.results,
        totalPages: outcome.totalPages,
        groups,
        startUrl,
        collectedAt: new Date(),
        menus,
      });
    } catch (error) {
      showError(error);
    }
  };

  // [수집 시작]/[메뉴 읽기]: 메뉴를 읽고, 전체 수집이면 바로 수집, 메뉴 고르기면 고르기 화면으로 (PLAN 작업 25)
  const start = async (startUrl: string, mode: CollectMode) => {
    setScreen({ kind: '수집 중', progress: null });
    try {
      const { batches } = await fetchBatches(startUrl);
      if (mode === '메뉴 고르기') setScreen({ kind: '메뉴 선택', startUrl, batches });
      else await run(startUrl, batches);
    } catch (error) {
      showError(error);
    }
  };

  // [엑셀 다운로드]: 실패 페이지가 있으면 확인창 → 그림 미리보기 준비 → 엑셀 만들기 → 내려받기
  // (PRD must 2·nice 2, DESIGN.md 8·16장)
  const download = async () => {
    if (screen.kind !== '결과' || downloadLabel) return;
    setDownloadLabel('엑셀 만드는 중…');
    try {
      await downloadExcel(screen, (status) =>
        setDownloadLabel(status.step === '그림 준비' ? `그림 준비 중… ${status.done}/${status.total}` : '엑셀 만드는 중…'),
      );
    } catch (error) {
      console.error('[엑셀 다운로드]', error);
      window.alert('엑셀을 만드는 중 문제가 생겼어요. 다시 시도해 주세요.');
    } finally {
      setDownloadLabel(null);
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

        {screen.kind === '메뉴 선택' && (
          <MenuPicker
            batches={screen.batches}
            onPick={(menus) => run(screen.startUrl, pickBatches(screen.batches, menus), menus)}
            onCancel={() => setScreen({ kind: '시작' })}
          />
        )}

        {screen.kind === '수집 중' && <ProgressPanel progress={screen.progress} />}

        {screen.kind === '결과' && (
          <div className="flex flex-col gap-6">
            <ResultSummary
              results={screen.results}
              totalPages={screen.totalPages}
              groups={screen.groups}
              menus={screen.menus}
              onDownload={download}
              downloadLabel={downloadLabel}
            />
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
