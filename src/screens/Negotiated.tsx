import { Fragment, useState } from 'react';
import { useStore, evalCondition } from '../store/useStore';
import type { Account, FeeRule } from '../domain/types';
import { TODAY } from '../domain/types';

/** 월말 overflow를 안전하게 처리하는 월 단위 날짜 더하기.
 * 예: 2026-08-31 + 6개월 → 2027-02-28 (2월 말일로 clamp) */
export function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonthIndex = (m - 1) + n;
  const targetYear = y + Math.floor(totalMonthIndex / 12);
  const targetMonth0 = ((totalMonthIndex % 12) + 12) % 12; // 0-based, safe for negative n
  const daysInTargetMonth = new Date(targetYear, targetMonth0 + 1, 0).getDate();
  const day = Math.min(d, daysInTargetMonth);
  const mm = String(targetMonth0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/** 원 단위 금액을 억 단위 한국식 표기로 변환 (예: 850,000,000 → "8.5억") */
function formatEok(won: number): string {
  const eok = Math.round((won / 100_000_000) * 10) / 10;
  const text = Number.isInteger(eok) ? String(eok) : eok.toFixed(1);
  return `${text}억`;
}

function dDay(endDate: string): number {
  return Math.round((Date.parse(endDate) - Date.parse(TODAY)) / 86_400_000);
}

interface Row { rule: FeeRule; account: Account }

export default function Negotiated() {
  const { rules, accounts, enrollments, extendNegotiated } = useStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows: Row[] = rules
    .filter((r) => r.type === 'NEGOTIATED')
    .flatMap((rule) => enrollments
      .filter((e) => e.ruleId === rule.id)
      .map((e) => ({ rule, account: accounts.find((a) => a.id === e.accountId) }))
      .filter((r): r is Row => !!r.account));

  if (rows.length === 0) {
    return (
      <section>
        <p className="empty">관리 중인 협의수수료가 없습니다.</p>
      </section>
    );
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section>
      <table>
        <thead>
          <tr>
            <th>계좌</th>
            <th>룰</th>
            <th>기간</th>
            <th>만료</th>
            <th>조건</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ rule, account }) => {
            const key = `${account.id}:${rule.id}`;
            const isOpen = expanded.has(key);
            const dday = dDay(rule.endDate);
            const soon = dday <= 30;
            const hasCondition = !!rule.condition;
            const ok = evalCondition(rule, account);
            const value = rule.condition
              ? (rule.condition.metric === '6개월평균자산' ? account.metric6mAsset : account.metric6mVolume)
              : 0;
            const pct = rule.condition ? Math.min(100, (value / rule.condition.threshold) * 100) : 0;

            return (
              <Fragment key={key}>
                <tr onClick={() => toggle(key)} style={{ cursor: 'pointer' }}>
                  <td>{account.id} {account.name}</td>
                  <td>{rule.name}</td>
                  <td>{rule.startDate} ~ {rule.endDate}</td>
                  <td className={soon ? 'warn' : undefined}>D{dday >= 0 ? '-' : '+'}{Math.abs(dday)}</td>
                  <td>
                    {hasCondition ? (
                      <div>
                        <div className={`bar ${ok ? 'ok' : 'fail'}`}><div style={{ width: `${pct}%` }} /></div>
                        <span className={`pill ${ok ? 'pill-active' : 'pill-rejected'}`}>
                          {rule.condition!.metric} {formatEok(value)} / 기준 {formatEok(rule.condition!.threshold)} ({ok ? '충족' : '미충족'})
                        </span>
                      </div>
                    ) : (
                      <span className="pill">조건 없음</span>
                    )}
                  </td>
                  <td>
                    {(!hasCondition || ok) ? (
                      <>
                        <button
                          className="btn primary"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            extendNegotiated(rule.id, addMonths(rule.endDate, 6));
                          }}
                        >
                          6개월 연장
                        </button>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>룰 전체 연장</div>
                      </>
                    ) : (
                      <>
                        <button className="btn" type="button" disabled>6개월 연장</button>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>조건 미충족</div>
                      </>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={6}>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {rule.log.map((entry, i) => <li key={i}>{entry}</li>)}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
