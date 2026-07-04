import { useState } from 'react';
import Dashboard from './screens/Dashboard';
import Wizard from './screens/Wizard';
import Approvals from './screens/Approvals';
import Negotiated from './screens/Negotiated';
import AccountView from './screens/AccountView';
import InstrumentMaster from './screens/InstrumentMaster';
import FeeTrace from './screens/FeeTrace';
import BatchOps from './screens/BatchOps';

const TABS = ['대시보드', '이벤트 등록', '승인함', '협수 관리', '계좌 조회', '수수료 결정 흐름', '종목 마스터', '배치 플로우'] as const;
type Tab = typeof TABS[number];

export default function App() {
  const [tab, setTab] = useState<Tab>('대시보드');
  return (
    <div className="app">
      <header>
        <h1>수수료 이벤트 플랫폼 <span className="badge">v0.5 프로토타입</span></h1>
        <nav>{TABS.map(t => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}</nav>
      </header>
      <main>
        {tab === '대시보드' && <Dashboard />}
        {tab === '이벤트 등록' && <Wizard />}
        {tab === '승인함' && <Approvals />}
        {tab === '협수 관리' && <Negotiated />}
        {tab === '계좌 조회' && <AccountView />}
        {tab === '수수료 결정 흐름' && <FeeTrace />}
        {tab === '종목 마스터' && <InstrumentMaster />}
        {tab === '배치 플로우' && <BatchOps />}
      </main>
    </div>
  );
}
