'use client';

// 결과 검색 — 검색창·필터 2개·결과 표 (DESIGN.md 4.3장, PLAN 작업 19)

import { useMemo, useState } from 'react';
import { MAX_SHOWN, MIN_QUERY_LENGTH, searchGroups, type KindFilter, type ScopeFilter } from '@/lib/search';
import type { Course, Group } from '@/lib/types';

/** 한 묶음에서 처음 보여 줄 위치 수. 나머지는 [더보기]로 펼친다 */
const LOCATIONS_PREVIEW = 3;

const SHORT: Record<Course, string> = { 초등: '초', 중학: '중', 고교: '고' };

export default function ResultSearch({ groups }: { groups: Group[] }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('전체');
  const [scope, setScope] = useState<ScopeFilter>('전체');

  const output = useMemo(() => searchGroups(groups, { query, kind, scope }), [groups, query, kind, scope]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <label htmlFor="search" className="sr-only">
          검색
        </label>
        <input
          id="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`바꿀 그림 파일 이름이나 문구를 입력하세요 (${MIN_QUERY_LENGTH}글자 이상)`}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Radios label="구분" name="kind" value={kind} options={['전체', '이미지', '문구']} onChange={setKind} />
          <Radios label="과정" name="scope" value={scope} options={['전체', '3과정 공통']} onChange={setScope} />
        </div>
      </div>

      {output.status === '짧음' ? (
        <p className="text-sm text-zinc-500" role="status">
          {MIN_QUERY_LENGTH}글자 이상 입력하세요
        </p>
      ) : (
        <>
          <p className="text-sm" role="status">
            전체 {output.total.toLocaleString('ko-KR')}건
            {output.total > MAX_SHOWN && ` (앞의 ${MAX_SHOWN}건만 표시 — 검색어를 더 자세히 입력하세요)`}
          </p>
          {output.shown.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
                    <th className="py-2 pr-3 font-medium">공통ID</th>
                    <th className="py-2 pr-3 font-medium">구분</th>
                    <th className="py-2 pr-3 font-medium">내용</th>
                    <th className="py-2 pr-3 font-medium">있는 과정</th>
                    <th className="py-2 font-medium">위치</th>
                  </tr>
                </thead>
                <tbody>
                  {output.shown.map((g) => (
                    <ResultRow key={g.id} group={g} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResultRow({ group }: { group: Group }) {
  const all3 = group.courses.length === 3;
  return (
    <tr className="border-b border-zinc-200 align-top dark:border-zinc-800">
      <td className="py-2 pr-3 font-mono whitespace-nowrap">
        <span className={all3 ? 'rounded bg-yellow-100 px-1 dark:bg-yellow-900/50' : undefined}>{group.id}</span>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">{group.kind}</td>
      <td className="max-w-xs py-2 pr-3 break-words">
        {group.kind === '이미지' ? (
          <>
            <a href={group.imageUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline dark:text-blue-400">
              🖼 {group.display}
            </a>
            {group.alt && <span className="block text-xs text-zinc-500">설명: {group.alt}</span>}
            {!group.comparable && <span className="block text-xs text-orange-600">비교 불가 (그림을 받지 못함)</span>}
          </>
        ) : (
          group.display
        )}
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">{group.courses.map((c) => SHORT[c]).join('·')}</td>
      <td className="py-2">
        <Locations group={group} />
      </td>
    </tr>
  );
}

/** 위치 목록: "초등: 메뉴 > 영역". 메뉴를 누르면 그 페이지가 새 탭으로 열린다 */
function Locations({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  const shown = open ? group.locations : group.locations.slice(0, LOCATIONS_PREVIEW);
  const rest = group.locations.length - LOCATIONS_PREVIEW;
  return (
    <ul className="flex flex-col gap-0.5">
      {shown.map((l) => (
        <li key={`${l.course}-${l.url}-${l.region}`}>
          {l.course}:{' '}
          <a href={l.url} target="_blank" rel="noreferrer" className="text-blue-700 underline dark:text-blue-400">
            {l.menu}
          </a>{' '}
          &gt; {l.region}
          {l.hidden && <span className="ml-1 text-xs text-zinc-500">(숨김)</span>}
        </li>
      ))}
      {rest > 0 && (
        <li>
          <button type="button" onClick={() => setOpen(!open)} className="text-xs text-zinc-600 underline dark:text-zinc-400">
            {open ? '접기' : `외 ${rest}곳 더보기`}
          </button>
        </li>
      )}
    </ul>
  );
}

function Radios<T extends string>(props: {
  label: string;
  name: string;
  value: T;
  options: T[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex items-center gap-3">
      <legend className="float-left mr-1 text-zinc-500">{props.label}</legend>
      {props.options.map((option) => (
        <label key={option} className="flex items-center gap-1">
          <input
            type="radio"
            aria-label={`${props.label} ${option}`}
            name={props.name}
            checked={props.value === option}
            onChange={() => props.onChange(option)}
          />
          {option}
        </label>
      ))}
    </fieldset>
  );
}
