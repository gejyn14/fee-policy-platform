import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { BatchJobResult } from '../domain/types';

type StoreState = ReturnType<typeof useStore.getState>;

const JOBS = [
  { key: 'lifecycle', title: '① 룰 발효/만료', run: (s: StoreState) => s.batchActivateExpireRules() },
  { key: 'metrics', title: '② 지표 재산정', run: (s: StoreState) => s.batchRecomputeMetrics() },
  { key: 'sync', title: '③ 종목 동기화', run: (s: StoreState) => s.batchSyncInstruments() },
  { key: 'nego', title: '④ 협수 조건 평가', run: (s: StoreState) => s.batchEvalNegotiations() },
  { key: 'rebind', title: '⑤ 바인딩 재계산', run: (s: StoreState) => s.batchRebind() },
  { key: 'dominance', title: '⑥ 지배관계 재검증', run: (s: StoreState) => s.batchRevalidateDominance() },
] as const;

export default function BatchOps() {
  const [results, setResults] = useState<Record<string, BatchJobResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function runBatch() {
    setResults({});
    setOpenKey(null);
    setDone(false);
    for (const job of JOBS) {
      setRunning(job.key);
      await new Promise((r) => setTimeout(r, 400)); // 순차 진행 연출
      const res = job.run(useStore.getState());
      setResults((prev) => ({ ...prev, [job.key]: res }));
    }
    setRunning(null);
    setDone(true);
  }

  function resetBatch() {
    useStore.getState().reset();
    setResults({});
    setRunning(null);
    setOpenKey(null);
    setDone(false);
  }

  const isEmpty = !done && running === null && Object.keys(results).length === 0;

  return (
    <div>
      <div className="actions">
        <button className="btn" onClick={runBatch} disabled={running !== null}>배치 실행</button>
        <button className="btn" onClick={resetBatch}>초기화</button>
      </div>

      {isEmpty && <p className="empty">[배치 실행]을 누르면 6개 잡이 순차로 돌며 실제 상태를 갱신합니다.</p>}

      <div className="stack">
        {JOBS.map((job, i) => {
          const result = results[job.key];
          const isRunning = running === job.key;
          const statusText = isRunning ? '실행 중…' : result ? result.summary : '대기';
          return (
            <div key={job.key}>
              <div
                className={`card batch-step ${isRunning ? 'batch-running' : result ? 'batch-done' : ''}`}
                style={result ? { cursor: 'pointer' } : undefined}
                onClick={result ? () => setOpenKey(openKey === job.key ? null : job.key) : undefined}
              >
                <h3>{job.title}</h3>
                <p>{statusText}</p>
              </div>
              {openKey === job.key && result && (
                <table>
                  <thead>
                    <tr><th>항목</th><th>내용</th></tr>
                  </thead>
                  <tbody>
                    {result.changes.length === 0 ? (
                      <tr><td colSpan={2}><p className="empty">변경 없음</p></td></tr>
                    ) : (
                      result.changes.map((c, ci) => (
                        <tr key={ci}><td>{c.label}</td><td>{c.detail}</td></tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
              {i < JOBS.length - 1 && <div className="batch-arrow">↓</div>}
            </div>
          );
        })}
      </div>

      {done && (
        <p className="trace-narration">
          배치가 실제 store를 변경했습니다 — 대시보드·계좌 조회·협수 관리가 갱신되었습니다(크로스스크린).
        </p>
      )}
    </div>
  );
}
