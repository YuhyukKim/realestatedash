"use client";

import { useId, useState } from "react";
import type { ComplexMasterRecord } from "./complex-master";
import type { TransitCoverage } from "./apartment-filter";

const PAGE_SIZE = 20;

export function TransitCoverageNotice({ coverage, unverified, onSelect }: {
  coverage: TransitCoverage;
  unverified: readonly ComplexMasterRecord[];
  onSelect: (record: ComplexMasterRecord) => void;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const listId = useId();
  const count = (value: number) => value.toLocaleString("ko-KR");
  return (
    <section className="finder-transit-coverage" aria-label="교통 검색 데이터 범위">
      <h3>교통 검색 데이터 범위</h3>
      <p className="finder-transit-counts" role="status">
        지역·가격·면적·입주년도·검색어 조건 대상 {count(coverage.candidateCount)}개 중{" "}
        좌표 확인 {count(coverage.coordinateCount)}개 · 좌표 미확인 {count(coverage.missingCoordinateCount)}개
      </p>
      {coverage.active ? (
        <>
          <p>
            교통 조건 충족 <strong>{count(coverage.matchedCount)}개</strong> ·{" "}
            좌표 확인·조건 미충족 {count(coverage.mismatchCount)}개 ·{" "}
            <strong>좌표 미확인으로 결과에서 제외 {count(coverage.unverifiedCount)}개</strong>
          </p>
          <p>좌표 미확인은 조건 미충족이 아닙니다. 결과 수가 실제 주변 단지 수를 뜻하지 않으며, 확인 필요 단지는 아래에서 별도로 볼 수 있습니다.</p>
        </>
      ) : (
        <p>교통 조건을 적용하지 않아 좌표 미확인 단지도 결과에 포함됩니다. 거리 정보가 없는 단지는 거리 정렬에서 마지막에 표시됩니다.</p>
      )}
      {coverage.active && unverified.length > 0 && (
        <details className="finder-unverified">
          <summary>교통조건 확인 필요 · {count(unverified.length)}개 단지 보기</summary>
          <p>다른 검색 조건은 충족하지만 좌표가 없어 지하철·거리·직장 조건을 판단할 수 없습니다. 아래 단지는 위 조회 결과 수·가격 통계·엑셀에 포함되지 않습니다.</p>
          <ul id={listId}>
            {unverified.slice(0, limit).map(record => (
              <li key={record.id}>
                <button type="button" onClick={() => onSelect(record)}
                  aria-label={`${record.name} 교통조건 미확인 단지 상세 보기`}>
                  <strong>{record.name}</strong>
                  <span>{record.address || `${record.district} ${record.dong}`}</span>
                  <small>좌표 미확인 · 교통조건 확인 필요</small>
                </button>
              </li>
            ))}
          </ul>
          {limit < unverified.length && (
            <button type="button" className="finder-unverified-more" aria-controls={listId}
              onClick={() => setLimit(value => value + PAGE_SIZE)}>
              확인 필요 단지 더 보기 · {count(Math.min(PAGE_SIZE, unverified.length - limit))}개
            </button>
          )}
        </details>
      )}
    </section>
  );
}
