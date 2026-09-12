"use client";
import { useRef } from "react";
import type { ComplexMasterRecord } from "./complex-master";
import { formatPrice } from "./price-format";
import { getNearbyStations, stationAvailabilityMessage } from "./stations";
import { usePanelFocus } from "./use-panel-focus";
export function ComparisonPanel({ records, month, areaLabel, onClose, onSelect }: {
  records: ComplexMasterRecord[]; month: string; areaLabel: string;
  onClose: () => void; onSelect: (record: ComplexMasterRecord) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  usePanelFocus(ref, onClose);
  const rows = [
    {label: "최근 매매", values: records.map(r => r.latestSale ? formatPrice(r.latestSale.price) : "가격 미확인")},
    {label: "계약일", values: records.map(r => r.latestSale?.date ?? "미확인")},
    {label: "거래 전용면적", values: records.map(r => {
      const sale = r.areaSales?.find(s => s.date === r.latestSale?.date && s.price === r.latestSale?.price && r.areas.includes(s.area));
      return sale ? sale.area.toFixed(1) + "㎡" : "미확인";
    })},
    {label: "위치", values: records.map(r => r.district + " " + r.dong)},
    {label: "입주·준공", values: records.map(r => r.buildYear ? r.buildYear + "년" : "미확인")},
    {label: "세대수", values: records.map(r => r.households ? r.households.toLocaleString() + "세대" : "미확인")},
    {label: "가장 가까운 역", values: records.map(r => {
      const s = getNearbyStations(r.id)[0];
      return s ? s.name + "역 · " + s.lines : stationAvailabilityMessage(r.id);
    })},
    {label: "역까지 직선거리", values: records.map(r => {
      const s = getNearbyStations(r.id)[0];
      return s ? Math.round(s.distanceMeters).toLocaleString() + "m" : "미확인";
    })},
    {label: "주소", values: records.map(r => r.address || "미확인")},
  ];
  return <div className="comparison-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="comparison-panel" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="comparison-title">
      <header><div><p className="finder-kicker">내 후보 나란히 보기</p><h2 id="comparison-title">단지 비교 · {records.length}개</h2></div>
        <button type="button" className="detail-close" onClick={onClose} aria-label="단지 비교 닫기">×</button></header>
      <p className="comparison-note">{month} 기준 저장 자료 · 전용면적 {areaLabel}. 단지별 거래 면적·계약일이 다를 수 있습니다. 미확인은 0원이나 거래 0건을 뜻하지 않습니다.</p>
      <div className="comparison-scroll" role="region" aria-label="선택 단지 비교표" tabIndex={0}>
        <table><caption className="sr-only">단지별 매매가, 계약일, 면적과 생활 조건 비교</caption>
          <thead><tr><th scope="col">비교 항목</th>{records.map(r => <th scope="col" key={r.id}><strong>{r.name}</strong>
            <button type="button" onClick={() => onSelect(r)} aria-label={r.name + " 비교표에서 상세 보기"}>상세 보기 ↗</button></th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((v,i) => <td key={records[i].id}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="comparison-note">직선거리는 보행 경로가 아닙니다. 전세·월세는 단지 상세에서 면적과 계약일을 함께 확인하세요.</p>
    </section>
  </div>;
}
