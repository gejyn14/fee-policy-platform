import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import type { AssetClass } from '../domain/types';
import type { Instrument } from '../masterdata/instruments';
import {
  toggleCode,
  selectCodes,
  selectAllMode,
  clearSelection,
  removeChip,
  summarize,
  parseCsvCodes,
} from './pickerLogic';
import type { Selection } from './pickerLogic';

// 거래소가 "품목/종목의 속성"인 상품군만 좌측에 거래소 filter chip + 전체선택 버튼을 노출한다.
// 국내주식(거래소=선택 차원, 위저드 체크박스로 별도 처리)·국내파생·금현물(거래소 숨김)은 노출하지 않는다.
const EXCHANGE_VISIBLE_CLASSES: AssetClass[] = ['해외주식', '해외파생'];

const CANDIDATE_CAP = 100;
const CHIP_CAP = 50;

type StatusFilter = '정상' | '거래정지';
const STATUS_OPTIONS: StatusFilter[] = ['정상', '거래정지'];

interface Props {
  assetClass: AssetClass;
  value: Selection;
  onChange: (s: Selection) => void;
}

export default function InstrumentPicker({ assetClass, value, onChange }: Props) {
  const instruments = useStore((s) => s.instruments);

  const [search, setSearch] = useState('');
  const [exchangeFilter, setExchangeFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<Set<StatusFilter>>(new Set(STATUS_OPTIONS));
  const [csvText, setCsvText] = useState('');
  const [csvResult, setCsvResult] = useState<{ accepted: number; rejected: number } | null>(null);

  const showExchangeChips = EXCHANGE_VISIBLE_CLASSES.includes(assetClass);

  // 상장폐지는 마스터 원본을 쓰므로 여기서 항상 제외한다.
  const inClass = useMemo(
    () => instruments.filter((i) => i.assetClass === assetClass && i.status !== '상장폐지'),
    [instruments, assetClass],
  );

  const nameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of instruments) m.set(i.code, i.name);
    return m;
  }, [instruments]);

  const statusByCode = useMemo(() => {
    const m = new Map<string, Instrument['status']>();
    for (const i of instruments) m.set(i.code, i.status);
    return m;
  }, [instruments]);

  const exchangeCounts = useMemo(() => {
    if (!showExchangeChips) return [] as Array<[string, number]>;
    const counts = new Map<string, number>();
    for (const i of inClass) counts.set(i.exchange, (counts.get(i.exchange) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [inClass, showExchangeChips]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inClass.filter((i) => {
      if (q && !i.code.toLowerCase().includes(q) && !i.name.toLowerCase().includes(q)) return false;
      if (showExchangeChips && exchangeFilter.length > 0 && !exchangeFilter.includes(i.exchange)) return false;
      if (!statusFilter.has(i.status as StatusFilter)) return false;
      return true;
    });
  }, [inClass, search, exchangeFilter, statusFilter, showExchangeChips]);

  const capped = filtered.slice(0, CANDIDATE_CAP);
  const overflow = filtered.length - capped.length;

  const validCodesSet = useMemo(() => new Set(inClass.map((i) => i.code)), [inClass]);

  const toggleExchangeFilter = (ex: string) => {
    setExchangeFilter((prev) => (prev.includes(ex) ? prev.filter((e) => e !== ex) : [...prev, ex]));
  };

  const toggleStatusFilter = (st: StatusFilter) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(st)) next.delete(st);
      else next.add(st);
      return next;
    });
  };

  const isRowSelected = (code: string): boolean =>
    value.products === '*' ? !value.excludeProducts.includes(code) : value.products.includes(code);

  const handleRowClick = (code: string) => onChange(toggleCode(value, code));

  const handleSelectAllFiltered = () => onChange(selectCodes(value, filtered.map((i) => i.code)));

  const handleSelectExchangeAll = (ex: string) => onChange(selectAllMode(value, [ex]));

  const handleCsvApply = () => {
    const { accepted, rejected } = parseCsvCodes(csvText, validCodesSet);
    onChange(selectCodes(value, accepted));
    setCsvResult({ accepted: accepted.length, rejected: rejected.length });
  };

  const selectedCodes = value.products === '*' ? [] : value.products;
  const excludeCodes = value.excludeProducts;
  const selectedCapped = selectedCodes.slice(0, CHIP_CAP);
  const selectedOverflow = selectedCodes.length - selectedCapped.length;
  const excludeCapped = excludeCodes.slice(0, CHIP_CAP);
  const excludeOverflow = excludeCodes.length - excludeCapped.length;

  return (
    <div className="picker">
      <div className="picker-panel picker-panel-left">
        <div className="field">
          <label>검색 (코드/이름)</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="코드 또는 이름으로 검색"
          />
        </div>

        {showExchangeChips && exchangeCounts.length > 0 && (
          <div className="picker-chip-row">
            {exchangeCounts.map(([ex, count]) => (
              <button
                key={ex}
                type="button"
                className={`picker-filter-chip${exchangeFilter.includes(ex) ? ' active' : ''}`}
                onClick={() => toggleExchangeFilter(ex)}
              >
                {ex} ({count})
              </button>
            ))}
          </div>
        )}

        <div className="picker-chip-row">
          {STATUS_OPTIONS.map((st) => (
            <button
              key={st}
              type="button"
              className={`picker-filter-chip${statusFilter.has(st) ? ' active' : ''}`}
              onClick={() => toggleStatusFilter(st)}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="picker-actions-row">
          <button
            type="button"
            className="btn"
            onClick={handleSelectAllFiltered}
            disabled={filtered.length === 0}
          >
            검색결과 전체 선택 ({filtered.length}건)
          </button>
        </div>

        {showExchangeChips && exchangeCounts.length > 0 && (
          <div className="picker-actions-row">
            {exchangeCounts.map(([ex]) => (
              <button key={ex} type="button" className="btn" onClick={() => handleSelectExchangeAll(ex)}>
                {ex} 전체 선택
              </button>
            ))}
          </div>
        )}

        <div className="picker-list">
          {capped.length === 0 ? (
            <div className="empty">조건에 맞는 종목이 없습니다.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>코드</th>
                  <th>이름</th>
                  <th>거래소</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {capped.map((i) => (
                  <tr
                    key={i.code}
                    className={isRowSelected(i.code) ? 'active' : ''}
                    onClick={() => handleRowClick(i.code)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{i.code}</td>
                    <td>{i.name}</td>
                    <td>{i.exchange}</td>
                    <td>{i.status === '거래정지' ? <span className="warn">⚠ 거래정지</span> : '정상'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {overflow > 0 && <p className="picker-overflow-note">그 외 {overflow}건 — 검색으로 좁히세요</p>}
        </div>

        <div className="field">
          <label>CSV 붙여넣기 (코드, 콤마/개행 구분)</label>
          <textarea
            rows={3}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="예: 005930, AAPL, 6A"
          />
          <div className="picker-actions-row">
            <button type="button" className="btn" onClick={handleCsvApply} disabled={csvText.trim().length === 0}>
              반영
            </button>
            {csvResult && (
              <span className="picker-csv-result">
                인식 {csvResult.accepted}건 / 무시 {csvResult.rejected}건
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="picker-panel picker-panel-right">
        <div className="picker-summary">{summarize(value)}</div>

        <div className="picker-chip-section">
          <h4>선택됨</h4>
          {value.products === '*' ? (
            <p className="picker-chip-note">전체 대상 (개별 선택 없음 — 아래 제외 목록 참고)</p>
          ) : selectedCodes.length === 0 ? (
            <p className="empty">선택된 종목이 없습니다.</p>
          ) : (
            <div className="picker-chip-row">
              {selectedCapped.map((code) => (
                <span key={code} className="picker-chip">
                  {statusByCode.get(code) === '거래정지' && <span className="warn">⚠ </span>}
                  {code} {nameByCode.get(code) ?? ''}
                  <button
                    type="button"
                    className="picker-chip-remove"
                    onClick={() => onChange(removeChip(value, code))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {selectedOverflow > 0 && <span className="picker-chip-more">외 {selectedOverflow}건</span>}
            </div>
          )}
        </div>

        {value.products === '*' && (
          <div className="picker-chip-section">
            <h4>제외됨</h4>
            {excludeCodes.length === 0 ? (
              <p className="empty">제외된 종목이 없습니다.</p>
            ) : (
              <div className="picker-chip-row">
                {excludeCapped.map((code) => (
                  <span key={code} className="picker-chip picker-chip-exclude">
                    {statusByCode.get(code) === '거래정지' && <span className="warn">⚠ </span>}
                    {code} {nameByCode.get(code) ?? ''}
                    <button
                      type="button"
                      className="picker-chip-remove"
                      onClick={() => onChange(removeChip(value, code))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {excludeOverflow > 0 && <span className="picker-chip-more">외 {excludeOverflow}건</span>}
              </div>
            )}
          </div>
        )}

        <div className="picker-actions-row">
          <button type="button" className="btn" onClick={() => onChange(selectAllMode(value, '*'))}>
            전체 대상으로 전환
          </button>
          <button type="button" className="btn" onClick={() => onChange(clearSelection(value))}>
            모두 지우기
          </button>
        </div>
      </div>
    </div>
  );
}
