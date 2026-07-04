import { Fragment, useState } from 'react';
import { useStore } from '../store/useStore';
import { TODAY } from '../domain/types';
import type { ScopeSelector } from '../domain/types';

/** 월말 overflow를 안전하게 처리하는 월 단위 날짜 더하기.
 * 예: 2026-08-31 + 6개월 → 2027-02-28 (2월 말일로 clamp) */
export function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonthIndex = (m - 1) + n;
  const targetYear = y + Math.floor(totalMonthIndex / 12);
  const targetMonth0 = ((totalMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth0 + 1, 0).getDate();
  const day = Math.min(d, daysInTargetMonth);
  return `${targetYear}-${String(targetMonth0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dDay(endDate: string): number {
  return Math.round((Date.parse(endDate) - Date.parse(TODAY)) / 86_400_000);
}

function scopeText(s: ScopeSelector): string {
  const parts: string[] = [s.assetClass];
  if (s.exchanges !== '*') parts.push(`거래소:${s.exchanges.join(',')}`);
  if (s.products !== '*') parts.push(`품목:${s.products.join(',')}`);
  return parts.join(' · ');
}

export default function Negotiated() {
  const { nego, accounts, schedules, reviewNegoExtension, applyNegoExtension } = useStore();
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<Set<string>>(new Set());

  const extGroups = reviewNegoExtension();
  const totalC = extGroups.reduce((a, g) => ({ 유지: a.유지 + g.counts.유지, 탈락: a.탈락 + g.counts.탈락 }), { 유지: 0, 탈락: 0 });
  const statusPill = (s: '유지' | '탈락') => s === '탈락' ? 'pill-rejected' : 'pill-active';
  const gKey = (g: { axis: string; groupKey: string }) => `${g.axis}:${g.groupKey}`;

  const activeGrants = nego.filter((n) => n.status === '활성');
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const schedName = (id: string) => schedules.find((s) => s.id === id)?.name ?? id;

  function toggleGroup(key: string) {
    setOpenGroup((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <section className="stack">
      <div className="card">
        <h2>연장 대상 확인 (만료 임박 자동 산출)</h2>
        <p className="trace-narration">
          신청·승인은 계좌별로 하지만, 연장은 상품군(주식)·품목(파생) 단위로 활성 협의를 단체로 뽑아 자격을 재평가한다.
          <b> 유지</b>(자격 충족 또는 영업예외)·<b>탈락</b>(더는 미충족 → 해지 대상)으로 나뉜다.
        </p>
        <div className="check-grid" style={{ marginBottom: 12 }}>
          <span className="pill pill-active">유지 {totalC.유지}</span>
          <span className="pill pill-rejected">탈락 {totalC.탈락}</span>
          <button className="btn primary" type="button" disabled={extGroups.length === 0}
            onClick={() => setApplyMsg(applyNegoExtension().summary)}>일괄 연장 승인</button>
          {applyMsg && <span className="badge">{applyMsg}</span>}
        </div>
        {extGroups.length === 0 ? (
          <p className="empty">연장 대상 협의가 없습니다.</p>
        ) : (
          <table>
            <thead><tr><th>그룹</th><th>만료</th><th>유지</th><th>탈락</th></tr></thead>
            <tbody>
              {extGroups.map((g) => {
                const open = openGroup.has(gKey(g));
                const dday = dDay(g.endDate);
                return (
                  <Fragment key={gKey(g)}>
                    <tr onClick={() => toggleGroup(gKey(g))} style={{ cursor: 'pointer' }}>
                      <td>{g.axis === '품목' ? `품목 ${g.groupKey}` : g.groupKey}</td>
                      <td className={dday <= 30 ? 'warn' : undefined}>D{dday >= 0 ? '-' : '+'}{Math.abs(dday)}</td>
                      <td>{g.counts.유지}</td><td className={g.counts.탈락 ? 'warn' : undefined}>{g.counts.탈락}</td>
                    </tr>
                    {open && (
                      <tr><td colSpan={4}>
                        <table>
                          <thead><tr><th>계좌</th><th>분류</th><th>사유</th></tr></thead>
                          <tbody>
                            {g.candidates.map((c) => (
                              <tr key={c.accountId}>
                                <td>{c.accountId} {c.accountName}</td>
                                <td><span className={`pill ${statusPill(c.status)}`}>{c.status}</span></td>
                                <td>{c.detail}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>활성 협의 현황 (계좌별)</h2>
        {activeGrants.length === 0 ? (
          <p className="empty">활성 협의가 없습니다.</p>
        ) : (
          <table>
            <thead><tr><th>계좌</th><th>적용범위</th><th>요율표</th><th>유효기간</th><th>만료</th><th>자격</th></tr></thead>
            <tbody>
              {activeGrants.map((n, i) => {
                const dday = dDay(n.validTo);
                return (
                  <tr key={`${n.accountId}:${n.scheduleId}:${i}`}>
                    <td>{n.accountId} {nameOf(n.accountId)}</td>
                    <td>{scopeText(n.scope)}</td>
                    <td>{schedName(n.scheduleId)}</td>
                    <td>{n.validFrom} ~ {n.validTo}</td>
                    <td className={dday <= 30 ? 'warn' : undefined}>D{dday >= 0 ? '-' : '+'}{Math.abs(dday)}</td>
                    <td><span className={`pill ${n.qualify === '충족' ? 'pill-active' : 'pill-rejected'}`}>{n.qualify === '충족' ? '충족' : '영업예외'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
