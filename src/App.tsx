import { useState } from 'react';
import Dashboard from './screens/Dashboard';
import Wizard from './screens/Wizard';
import Approvals from './screens/Approvals';
import NegoRequest from './screens/NegoRequest';
import NegoApproval from './screens/NegoApproval';
import Negotiated from './screens/Negotiated';
import AccountView from './screens/AccountView';
import InstrumentMaster from './screens/InstrumentMaster';
import FeeTrace from './screens/FeeTrace';
import PolicyPriority from './screens/PolicyPriority';
import Live from './screens/Live';

const TABS = ['백엔드 연동', '대시보드', '정책 우선순위', '이벤트 등록', '승인함', '협의 신청', '협의 승인', '협수 관리', '계좌 조회', '종목 마스터', '수수료 결정 흐름'] as const;
type Tab = typeof TABS[number];

export default function App() {
  const [tab, setTab] = useState<Tab>('백엔드 연동');
  return (
    <div className="app">
      <header>
        <h1>수수료 정책 플랫폼 <span className="badge">v1 · Spring Boot + Postgres</span></h1>
        <nav>{TABS.map(t => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}</nav>
      </header>
      <main>
        {tab === '백엔드 연동' && <Live />}
        {tab === '대시보드' && <Dashboard />}
        {tab === '이벤트 등록' && <Wizard />}
        {tab === '승인함' && <Approvals />}
        {tab === '협의 신청' && <NegoRequest />}
        {tab === '협의 승인' && <NegoApproval />}
        {tab === '협수 관리' && <Negotiated />}
        {tab === '계좌 조회' && <AccountView />}
        {tab === '수수료 결정 흐름' && <FeeTrace />}
        {tab === '정책 우선순위' && <PolicyPriority />}
        {tab === '종목 마스터' && <InstrumentMaster />}
      </main>
    </div>
  );
}
