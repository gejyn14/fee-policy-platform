import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import type { AssetClass } from '../domain/types';
import type { Instrument } from '../masterdata/instruments';

const ASSET_CLASSES: AssetClass[] = ['국내주식', '해외주식', '국내파생', '해외파생', '금현물'];
const STATUS_OPTIONS: Instrument['status'][] = ['정상', '거래정지', '상장폐지'];
const DISPLAY_CAP = 100;
// 등록 화면에서 새로 만드는 종목의 고정 상장일 — parseMasterCsv는 순수 함수여야 하므로
// Date.now()를 쓰지 않고 데모 기준일(TODAY와 동일)을 그대로 사용한다.
const REGISTERED_AT = '2026-07-04';

const SESSIONS_BY_CLASS: Record<AssetClass, string[]> = {
  국내주식: ['정규'],
  해외주식: ['정규', '프리마켓'],
  국내파생: ['정규', '야간'],
  해외파생: ['주간', '야간'],
  금현물: ['정규'],
};

/**
 * CSV(코드,이름,상품군,거래소,통화) 텍스트를 파싱해 등록 가능한 Instrument와 거부 사유로 분류한다.
 * 순수 함수 — Math.random/Date.now 금지, listedAt은 고정값(REGISTERED_AT).
 * 검증: 5개 필수 필드 존재, 상품군 enum, 코드 중복(기존 마스터 + 같은 배치 내).
 */
export function parseMasterCsv(
  text: string,
  existingCodes: Set<string>,
): { accepted: Instrument[]; rejected: { line: string; reason: string }[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const accepted: Instrument[] = [];
  const rejected: { line: string; reason: string }[] = [];
  const seen = new Set(existingCodes);

  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length !== 5 || parts.some((p) => p === '')) {
      rejected.push({ line, reason: '필수값 누락 (코드,이름,상품군,거래소,통화 5개 필드 필요)' });
      continue;
    }
    const [code, name, assetClassRaw, exchange, currency] = parts;
    if (!ASSET_CLASSES.includes(assetClassRaw as AssetClass)) {
      rejected.push({
        line,
        reason: `상품군 오류: '${assetClassRaw}'는 유효하지 않음 (국내주식/해외주식/국내파생/해외파생/금현물 중 하나여야 함)`,
      });
      continue;
    }
    if (seen.has(code)) {
      rejected.push({ line, reason: `중복 코드: '${code}'는 이미 마스터 또는 등록분에 존재함` });
      continue;
    }
    const assetClass = assetClassRaw as AssetClass;
    seen.add(code);
    accepted.push({
      assetClass,
      exchange,
      code,
      name,
      currency,
      sessions: SESSIONS_BY_CLASS[assetClass] ?? ['정규'],
      status: '정상',
      listedAt: REGISTERED_AT,
    });
  }

  return { accepted, rejected };
}

function statusPillClass(status: Instrument['status']): string {
  if (status === '정상') return 'pill-active';
  if (status === '거래정지') return 'pill-pending';
  return 'pill-rejected'; // 상장폐지
}

export default function InstrumentMaster() {
  const { instruments, syncFromLedger, registerInstruments } = useStore();

  const [query, setQuery] = useState('');
  const [assetFilter, setAssetFilter] = useState<AssetClass | '전체'>('전체');
  const [exchangeFilter, setExchangeFilter] = useState('전체');
  const [statusFilter, setStatusFilter] = useState<Instrument['status'] | '전체'>('전체');

  const [csvText, setCsvText] = useState('');
  const [registerResult, setRegisterResult] = useState<{ accepted: number; rejected: string[] } | null>(null);

  const [syncResult, setSyncResult] = useState<{ added: number; incoming: Instrument[] } | null>(null);

  const exchangeOptions = useMemo(
    () => [...new Set(instruments.map((i) => i.exchange))].sort(),
    [instruments],
  );

  const totalCount = instruments.length;
  const suspendedCount = instruments.filter((i) => i.status === '거래정지').length;
  const byAssetClass = useMemo(
    () => ASSET_CLASSES.map((ac) => ({ ac, count: instruments.filter((i) => i.assetClass === ac).length })),
    [instruments],
  );

  const q = query.trim().toUpperCase();
  const filtered = useMemo(() => instruments.filter((i) =>
    (assetFilter === '전체' || i.assetClass === assetFilter) &&
    (exchangeFilter === '전체' || i.exchange === exchangeFilter) &&
    (statusFilter === '전체' || i.status === statusFilter) &&
    (q === '' || i.code.toUpperCase().includes(q) || i.name.toUpperCase().includes(q))
  ), [instruments, assetFilter, exchangeFilter, statusFilter, q]);

  const visible = filtered.slice(0, DISPLAY_CAP);
  const overflow = filtered.length - visible.length;

  const existingCodes = useMemo(() => new Set(instruments.map((i) => i.code)), [instruments]);
  const parsedCsv = useMemo(() => parseMasterCsv(csvText, existingCodes), [csvText, existingCodes]);

  function handleRegister() {
    if (parsedCsv.accepted.length === 0) return;
    const result = registerInstruments(parsedCsv.accepted);
    setRegisterResult(result);
    setCsvText('');
  }

  function handleSync() {
    const beforeLen = useStore.getState().instruments.length;
    const { added } = syncFromLedger();
    const incoming = added > 0 ? useStore.getState().instruments.slice(beforeLen) : [];
    setSyncResult({ added, incoming });
  }

  return (
    <section>
      <div className="cards">
        <div className="card"><h3>{totalCount}</h3><p>총 종목 수</p></div>
        {byAssetClass.map(({ ac, count }) => (
          <div className="card" key={ac}><h3>{count}</h3><p>{ac}</p></div>
        ))}
        <div className="card warn"><h3>{suspendedCount}</h3><p>거래정지</p></div>
      </div>

      <h2>종목 조회</h2>
      <div className="form-grid">
        <div className="field">
          <label>검색</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="코드/이름" />
        </div>
        <div className="field">
          <label>상품군</label>
          <select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value as AssetClass | '전체')}>
            <option value="전체">전체</option>
            {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="field">
          <label>거래소</label>
          <select value={exchangeFilter} onChange={(e) => setExchangeFilter(e.target.value)}>
            <option value="전체">전체</option>
            {exchangeOptions.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
          </select>
        </div>
        <div className="field">
          <label>상태</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Instrument['status'] | '전체')}>
            <option value="전체">전체</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>코드</th><th>이름</th><th>상품군</th><th>거래소</th><th>통화</th><th>상태</th><th>상장일</th></tr>
        </thead>
        <tbody>
          {visible.map((i) => (
            <tr key={`${i.exchange}:${i.code}`}>
              <td>{i.code}</td>
              <td>{i.name}</td>
              <td>{i.assetClass}</td>
              <td>{i.exchange}</td>
              <td>{i.currency}</td>
              <td><span className={`pill ${statusPillClass(i.status)}`}>{i.status}</span></td>
              <td>{i.listedAt}</td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={7} className="empty">검색 결과 없음</td></tr>
          )}
        </tbody>
      </table>
      {overflow > 0 && <p>그 외 {overflow}건 — 검색으로 좁히세요</p>}

      <h2>CSV 등록</h2>
      <div className="stack">
        <div className="field">
          <label>코드,이름,상품군,거래소,통화 (줄바꿈으로 여러 건)</label>
          <textarea rows={5} value={csvText} onChange={(e) => setCsvText(e.target.value)}
            placeholder="예: 000660,SK하이닉스,국내주식,KRX,KRW" />
        </div>

        {csvText.trim() !== '' && (
          <table>
            <thead><tr><th>입력</th><th>결과</th><th>사유</th></tr></thead>
            <tbody>
              {parsedCsv.accepted.map((i) => (
                <tr key={i.code}>
                  <td>{i.code},{i.name},{i.assetClass},{i.exchange},{i.currency}</td>
                  <td><span className="pill pill-active">수용</span></td>
                  <td>-</td>
                </tr>
              ))}
              {parsedCsv.rejected.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.line}</td>
                  <td><span className="pill pill-rejected">거부</span></td>
                  <td className="warn">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="actions">
          <button className="btn primary" type="button" disabled={parsedCsv.accepted.length === 0} onClick={handleRegister}>
            등록 ({parsedCsv.accepted.length}건)
          </button>
        </div>
        {registerResult && (
          <p>
            등록 완료: 수용 {registerResult.accepted}건
            {registerResult.rejected.length > 0
              ? `, 거부 ${registerResult.rejected.length}건 (${registerResult.rejected.join(', ')})`
              : ''}
          </p>
        )}
      </div>

      <h2>원장 동기화</h2>
      <div className="stack">
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn primary" type="button" onClick={handleSync}>원장 동기화</button>
        </div>
        {syncResult && (
          syncResult.added === 0 ? (
            <p className="empty">신규 상장 없음</p>
          ) : (
            <div>
              <p>신규 상장 {syncResult.added}건 유입</p>
              <table>
                <thead><tr><th>코드</th><th>이름</th><th>상품군</th><th>거래소</th></tr></thead>
                <tbody>
                  {syncResult.incoming.map((i) => (
                    <tr key={i.code}><td>{i.code}</td><td>{i.name}</td><td>{i.assetClass}</td><td>{i.exchange}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </section>
  );
}
