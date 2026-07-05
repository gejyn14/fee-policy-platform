import { useState } from 'react';
import { useStore } from '../store/useStore';
import { isDerivative } from '../domain/feeKey';
import { parseCsvCodes } from './pickerLogic';
import type { AssetClass, FeeComponent, ScopeSelector } from '../domain/types';

const ASSET_CLASSES: AssetClass[] = ['국내주식', '해외주식', '국내파생', '해외파생', '금현물'];

function compText(c: FeeComponent): string {
  if (c.rateType === '정률') return `${c.rateBp ?? 0}bp`;
  if (c.rateType === '정액') return `${(c.flatAmount ?? 0).toLocaleString()}원`;
  return '구간표';
}

export default function NegoRequest() {
  const { accounts, schedules, qualifyStatus, submitNegoRequest, addSchedule } = useStore();
  const negoScheds = schedules.filter((s) => s.id.startsWith('FS-NEGO'));

  const [assetClass, setAssetClass] = useState<AssetClass>('해외주식');
  const [exText, setExText] = useState('*');
  const [prodText, setProdText] = useState('*');
  const [scheduleId, setScheduleId] = useState(negoScheds[0]?.id ?? '');
  const [rateOverride, setRateOverride] = useState('');   // '' = 요율 수정 안 함(자사 bp)
  const [csv, setCsv] = useState('');
  const [bypass, setBypass] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const deriv = isDerivative(assetClass);
  const sched = schedules.find((s) => s.id === scheduleId);
  const jasa = sched?.components.find((c) => c.kind === '자사');
  const editable = jasa != null && (jasa.rateType === '정률' || jasa.rateType === '정액');
  const unit = jasa?.rateType === '정액' ? '원' : 'bp';
  const parsed = parseCsvCodes(csv, new Set(accounts.map((a) => a.id)));

  const scope: ScopeSelector = {
    assetClass,
    exchanges: exText.trim() === '*' || exText.trim() === '' ? '*' : exText.split(',').map((t) => t.trim()).filter(Boolean),
    sessions: '*', channels: '*', currencies: '*',
    products: deriv && prodText.trim() !== '*' && prodText.trim() !== '' ? prodText.split(',').map((t) => t.trim()).filter(Boolean) : '*',
    excludeProducts: [],
  };

  function nameOf(id: string) { return accounts.find((a) => a.id === id)?.name ?? ''; }

  function handleSubmit() {
    let sid = scheduleId;
    if (rateOverride.trim() !== '' && sched && editable) {
      sid = `${scheduleId}-CUSTOM-${rateOverride}`;
      const comps = sched.components.map((c) => c.kind === '자사'
        ? (c.rateType === '정액' ? { ...c, flatAmount: Number(rateOverride) } : { ...c, rateBp: Number(rateOverride) })
        : c);
      addSchedule({ id: sid, name: `${sched.name} (자사 ${rateOverride}${unit} 조정)`, components: comps });
    }
    const bp: Record<string, string> = {};
    for (const id of parsed.accepted) {
      if (!qualifyStatus(assetClass, id).met) bp[id] = (bypass[id] ?? '').trim() || '영업상 우대 필요';
    }
    const { requested } = submitNegoRequest({ accountIds: parsed.accepted, scope, scheduleId: sid, bypass: bp, requestedBy: '현업담당자' });
    setMsg(`협의 요청 ${requested}건 접수 — [협의 승인] 탭에서 결재됩니다.`);
    setCsv(''); setBypass({});
  }

  const ready = parsed.accepted.length > 0 && !!sched;

  return (
    <section className="stack">
      <div className="card">
        <h2>협의수수료 신청</h2>
        <p className="trace-narration">적용범위·요율표·계좌 리스트를 입력하면 계좌별 자격을 자동 판정합니다. 미충족 계좌는 영업 사유로 예외 신청할 수 있습니다.</p>

        <div className="form-grid">
          <div className="field">
            <label>상품군</label>
            <select value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)}>
              {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field">
            <label>거래소(콤마, * = 전체)</label>
            <input value={exText} onChange={(e) => setExText(e.target.value)} placeholder="* 또는 CME, NASDAQ" />
          </div>
          {deriv && (
            <div className="field">
              <label>품목(콤마, * = 전체)</label>
              <input value={prodText} onChange={(e) => setProdText(e.target.value)} placeholder="6A, 6B" />
            </div>
          )}
          <div className="field">
            <label>요율표(선택)</label>
            <select value={scheduleId} onChange={(e) => { setScheduleId(e.target.value); setRateOverride(''); }}>
              {negoScheds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>자사 요율 수정({unit}, 비우면 원본)</label>
            {editable ? (
              <input type="number" value={rateOverride} onChange={(e) => setRateOverride(e.target.value)}
                placeholder={jasa?.rateType === '정액' ? '예: 1000' : '예: 6'} />
            ) : (
              <input value="구간표 요율표는 선택만(화면 수정 미지원)" disabled />
            )}
          </div>
        </div>

        {sched && (
          <p className="trace-narration">요율표 구성: {sched.components.map((c) => `${c.name} ${compText(c)}`).join(' · ')}</p>
        )}

        <div className="field">
          <label>계좌번호 붙여넣기(콤마/줄바꿈)</label>
          <textarea rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="110000001002, 110000001004" />
          <p>인식된 계좌 {parsed.accepted.length}건{parsed.rejected.length > 0 && <span className="warn"> · 무시 {parsed.rejected.join(', ')}</span>}</p>
        </div>
      </div>

      {parsed.accepted.length > 0 && (
        <div className="card">
          <h2>자격 판정</h2>
          <table>
            <thead><tr><th>계좌</th><th>자격</th><th>영업 예외 사유(미충족 시)</th></tr></thead>
            <tbody>
              {parsed.accepted.map((id) => {
                const q = qualifyStatus(assetClass, id);
                return (
                  <tr key={id}>
                    <td>{id} {nameOf(id)}</td>
                    <td><span className={`pill ${q.met ? 'pill-active' : 'pill-rejected'}`}>{q.met ? '충족' : '미충족'}</span></td>
                    <td>{q.met ? '-' : (
                      <input value={bypass[id] ?? ''} onChange={(e) => setBypass((b) => ({ ...b, [id]: e.target.value }))} placeholder="영업상 우대 필요" />
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions">
        <button className="btn primary" type="button" disabled={!ready} onClick={handleSubmit}>협수 요청</button>
        {msg && <span className="badge">{msg}</span>}
      </div>
    </section>
  );
}
