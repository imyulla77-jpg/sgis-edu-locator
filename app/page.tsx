'use client';

// 메인 화면 — 시작 → 진행 → 결과 상태 전환과 진행 지휘 (DESIGN.md 8장, PLAN 작업 15~17)
// 결과는 브라우저 메모리에만 있다(DB 없음). 엑셀은 [엑셀 다운로드]를 누를 때 브라우저 안에서 만든다(lib/download.ts).

import { useEffect, useState } from 'react';
import ProgressPanel from '@/components/ProgressPanel';
import ResultSummary from '@/components/ResultSummary';
import StartForm from '@/components/StartForm';
import { downloadExcel } from '@/lib/download';
import { RequestError, runAll, type RunOutcome, type RunProgress } from '@/lib/run-steps';
import { DEFAULT_START_URL } from '@/lib/url';

type Screen =
  | { kind: '시작'; notice?: string }
  | { kind: '진행'; progress: RunProgress }
  | { kind: '결과'; outcome: RunOutcome }
  | { kind: '오류'; message: string };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: '시작' });
  /** 서버가 실행 비밀번호를 요구했는지 (배포본) */
  const [askPassword, setAskPassword] = useState(false);
  const [lastUrl, setLastUrl] = useState(DEFAULT_START_URL);
  /** 엑셀을 만드는 중이면 버튼에 보여 줄 글자, 아니면 null */
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);

  // 진행·결과 화면에서 창을 닫거나 새로고침하려 하면 브라우저 기본 경고창을 띄운다
  // (결과는 브라우저 메모리에만 있어서 창을 닫으면 사라지기 때문. 문구는 브라우저가 정한다)
  const mustWarn = screen.kind === '진행' || screen.kind === '결과';
  useEffect(() => {
    if (!mustWarn) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ''; // 오래된 브라우저에서도 경고창이 뜨도록
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [mustWarn]);

  // [검색 시작]: 대상 찾기 → 수집 → AI 판단 → 결과
  const start = async (startUrl: string, password: string) => {
    setLastUrl(startUrl);
    setScreen({ kind: '진행', progress: { step: '대상 찾기', done: 0, total: 0, problems: 0 } });
    try {
      const outcome = await runAll(startUrl, (progress) => setScreen({ kind: '진행', progress }), { password });
      setScreen({ kind: '결과', outcome });
    } catch (error) {
      // 비밀번호가 필요하거나 틀렸으면 시작 화면에서 다시 넣게 한다
      if (error instanceof RequestError && error.passwordRequired) {
        setAskPassword(true);
        setScreen({ kind: '시작', notice: password ? error.message : '이 주소에서는 실행 비밀번호가 필요해요' });
        return;
      }
      setScreen({ kind: '오류', message: error instanceof Error ? error.message : '검색 중 문제가 생겼어요' });
    }
  };

  // [엑셀 다운로드]: 실패·확인 필요가 있으면 확인창 → 5개 시트 엑셀 만들기 → 내려받기 (PRD must 2)
  const download = async () => {
    if (screen.kind !== '결과' || downloadLabel) return;
    setDownloadLabel('엑셀 만드는 중…');
    try {
      await downloadExcel(screen.outcome);
    } catch (error) {
      console.error('[엑셀 다운로드]', error);
      window.alert('엑셀을 만드는 중 문제가 생겼어요. 다시 시도해 주세요.');
    } finally {
      setDownloadLabel(null);
    }
  };

  // [다시 검색]: 지금 결과를 지우고 시작 화면으로. 되돌릴 수 없으니 먼저 확인한다
  const restart = () => {
    if (window.confirm('지금 검색 결과가 사라져요. 다시 검색할까요?')) setScreen({ kind: '시작' });
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">SGIS에듀 현행화 대상 찾기</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          그림 속 최고 연도가 2026년 이하인 그림과 고칠 문장, SGIS 홈페이지 재캡처 경로를 찾아 엑셀로 정리해요
        </p>
      </header>

      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        {screen.kind === '시작' && (
          <StartForm onStart={start} askPassword={askPassword} notice={screen.notice} initialUrl={lastUrl} />
        )}

        {screen.kind === '진행' && <ProgressPanel progress={screen.progress} />}

        {screen.kind === '결과' && (
          <div className="flex flex-col gap-6">
            <ResultSummary outcome={screen.outcome} onDownload={download} downloadLabel={downloadLabel} />
            <button
              type="button"
              onClick={restart}
              className="self-end rounded-md border border-zinc-300 px-4 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              다시 검색
            </button>
          </div>
        )}

        {/* 처음 3페이지 연속 실패·대상 찾기 실패 등: 빨간 안내와 [처음으로] */}
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
