import { useState } from 'react';
import { useStore } from '../store/useStore';
import RuleDetail from './RuleDetail';

export default function Approvals() {
  const { rules, approveRule, rejectRule } = useStore();
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const pending = rules.filter((r) => r.status === '승인대기');

  function setReason(id: string, v: string) {
    setReasons((r) => ({ ...r, [id]: v }));
  }

  function handleReject(id: string) {
    const reason = (reasons[id] ?? '').trim();
    if (!reason) return;
    rejectRule(id, reason);
    setReasons((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
  }

  if (pending.length === 0) {
    return (
      <section>
        <p className="empty">대기 중인 결재가 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="stack">
      {pending.map((rule) => {
        const reason = reasons[rule.id] ?? '';

        return (
          <div className="card" key={rule.id}>
            <RuleDetail rule={rule} />

            <div className="form-grid" style={{ marginTop: 16 }}>
              <div className="field">
                <label>반려 사유</label>
                <input value={reason} onChange={(e) => setReason(rule.id, e.target.value)}
                  placeholder="반려 시 사유를 입력하세요" />
              </div>
            </div>

            <div className="actions">
              <button className="btn danger" type="button" disabled={!reason.trim()}
                onClick={() => handleReject(rule.id)}>반려</button>
              <button className="btn primary" type="button"
                onClick={() => approveRule(rule.id)}>승인</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
