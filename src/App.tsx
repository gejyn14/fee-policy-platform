import { useState } from 'react';
import Dashboard from './screens/Dashboard';

const TABS = ['대시보드', '이벤트 등록', '승인함', '협수 관리', '계좌 조회'] as const;
type Tab = typeof TABS[number];

export default function App() {
  const [tab, setTab] = useState<Tab>('대시보드');
  return (
    <div className="app">
      <header>
        <h1>수수료 이벤트 플랫폼 <span className="badge">v0 프로토타입</span></h1>
        <nav>{TABS.map(t => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}</nav>
      </header>
      <main>
        {tab === '대시보드' && <Dashboard />}
        {tab === '이벤트 등록' && <p>구현 예정 (Task 7)</p>}
        {tab === '승인함' && <p>구현 예정 (Task 8)</p>}
        {tab === '협수 관리' && <p>구현 예정 (Task 9)</p>}
        {tab === '계좌 조회' && <p>구현 예정 (Task 10)</p>}
      </main>
    </div>
  );
}
