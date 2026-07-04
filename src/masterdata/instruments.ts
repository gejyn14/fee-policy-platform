import type { AssetClass } from '../domain/types';

export interface Instrument {
  assetClass: AssetClass; exchange: string; code: string; name: string;
  currency: string; sessions: string[];
  status: '정상' | '거래정지' | '상장폐지';
  nxtTradable?: boolean; listedAt: string;
}

// 시드 LCG — Math.random 금지 (결정성)
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32);
}

function randDate(rnd: () => number): string {
  const year = 1990 + Math.floor(rnd() * 36); // 1990-2025
  const month = 1 + Math.floor(rnd() * 12);
  const day = 1 + Math.floor(rnd() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function randStatus(rnd: () => number): Instrument['status'] {
  const r = rnd();
  if (r < 0.005) return '상장폐지';
  if (r < 0.02) return '거래정지';
  return '정상';
}

const LEGACY: Instrument[] = [
  { assetClass: '국내주식', exchange: 'KRX', code: '005930', name: '삼성전자', currency: 'KRW', sessions: ['정규'], status: '정상', nxtTradable: true, listedAt: '1975-06-11' },
  { assetClass: '해외주식', exchange: 'NASDAQ', code: 'AAPL', name: '애플', currency: 'USD', sessions: ['정규', '프리마켓'], status: '정상', listedAt: '1980-12-12' },
  { assetClass: '국내파생', exchange: 'KRX', code: 'K200OPT', name: 'KOSPI200옵션', currency: 'KRW', sessions: ['정규', '야간'], status: '정상', listedAt: '1997-07-07' },
  { assetClass: '해외파생', exchange: 'CME', code: '6A', name: 'Australian Dollar', currency: 'USD', sessions: ['주간', '야간'], status: '정상', listedAt: '1987-01-13' },
  { assetClass: '해외파생', exchange: 'CME', code: '6B', name: 'British Pound', currency: 'USD', sessions: ['주간', '야간'], status: '정상', listedAt: '1975-02-13' },
  { assetClass: '금현물', exchange: 'KRX', code: 'GOLD99', name: 'KRX 금 99.99', currency: 'KRW', sessions: ['정규'], status: '정상', listedAt: '2014-03-24' },
];

// 해외파생 품목 — 실명 위주 하드코딩 (레거시 6A/6B 제외 대역)
const FOREIGN_DERIV: Array<[code: string, name: string, exchange: string, currency: string]> = [
  ['6E', 'Euro FX', 'CME', 'USD'],
  ['6J', 'Japanese Yen', 'CME', 'USD'],
  ['6C', 'Canadian Dollar', 'CME', 'USD'],
  ['6S', 'Swiss Franc', 'CME', 'USD'],
  ['6N', 'New Zealand Dollar', 'CME', 'USD'],
  ['ES', 'E-mini S&P 500', 'CME', 'USD'],
  ['NQ', 'E-mini Nasdaq 100', 'CME', 'USD'],
  ['YM', 'E-mini Dow', 'CBOT', 'USD'],
  ['RTY', 'E-mini Russell 2000', 'CME', 'USD'],
  ['CL', 'WTI Crude Oil', 'NYMEX', 'USD'],
  ['NG', 'Natural Gas', 'NYMEX', 'USD'],
  ['HO', 'Heating Oil', 'NYMEX', 'USD'],
  ['RB', 'RBOB Gasoline', 'NYMEX', 'USD'],
  ['GC', 'Gold Futures', 'COMEX', 'USD'],
  ['SI', 'Silver Futures', 'COMEX', 'USD'],
  ['HG', 'Copper Futures', 'COMEX', 'USD'],
  ['PL', 'Platinum Futures', 'NYMEX', 'USD'],
  ['ZN', '10-Year T-Note', 'CBOT', 'USD'],
  ['ZB', '30-Year T-Bond', 'CBOT', 'USD'],
  ['ZF', '5-Year T-Note', 'CBOT', 'USD'],
  ['ZT', '2-Year T-Note', 'CBOT', 'USD'],
  ['ZC', 'Corn', 'CBOT', 'USD'],
  ['ZS', 'Soybean', 'CBOT', 'USD'],
  ['ZW', 'Wheat', 'CBOT', 'USD'],
  ['FDAX', 'DAX Futures', 'EUREX', 'EUR'],
  ['FESX', 'EURO STOXX 50', 'EUREX', 'EUR'],
  ['FGBL', 'Euro-Bund', 'EUREX', 'EUR'],
  ['FGBM', 'Euro-Bobl', 'EUREX', 'EUR'],
  ['FGBS', 'Euro-Schatz', 'EUREX', 'EUR'],
  ['TW', 'FTSE Taiwan', 'SGX', 'USD'],
  ['NK', 'Nikkei 225', 'SGX', 'USD'],
  ['SG1', 'MSCI Singapore', 'SGX', 'USD'],
  ['HSI', 'Hang Seng Index', 'HKEX', 'HKD'],
  ['MHI', 'Mini Hang Seng', 'HKEX', 'HKD'],
  ['HHI', 'H-shares Index', 'HKEX', 'HKD'],
  ['JGB', 'Japanese Government Bond', 'OSE', 'JPY'],
  ['TOPIXF', 'TOPIX Futures', 'OSE', 'JPY'],
];

// 국내파생 품목 — 레거시 K200OPT 제외 대역
const DOMESTIC_DERIV: Array<[code: string, name: string]> = [
  ['K200FUT', 'KOSPI200선물'],
  ['K200MINI', 'KOSPI200미니선물'],
  ['K200WKLY', 'KOSPI200위클리옵션'],
  ['KQ150FUT', 'KOSDAQ150선물'],
  ['KQ150OPT', 'KOSDAQ150옵션'],
  ['KTB3F', '국채3년선물'],
  ['KTB10F', '국채10년선물'],
  ['KTB5F', '국채5년선물'],
  ['USDFUT', '미국달러선물'],
  ['USDOPT', '미국달러옵션'],
  ['STKFUT01', '주식선물(삼성전자)'],
  ['STKOPT01', '주식옵션(삼성전자)'],
  ['GOLDFUT', '금선물'],
  ['EUSTOXF', '유로스톡스50선물(국내상장)'],
];

const DOMESTIC_STOCK_COUNT = 1800;
const FOREIGN_STOCK_COUNT = 1000;
const FOREIGN_EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX'];

export function generateInstruments(): Instrument[] {
  const rnd = lcg(20260704);
  const out: Instrument[] = [...LEGACY];

  // 국내주식 ~1800: 코드 '6' 대역 순번(레거시 '005930'과 충돌 없음), 이름 '한국기업NNNN'
  for (let i = 0; i < DOMESTIC_STOCK_COUNT; i++) {
    const code = String(600000 + i);
    out.push({
      assetClass: '국내주식',
      exchange: 'KRX',
      code,
      name: `한국기업${String(i + 1).padStart(4, '0')}`,
      currency: 'KRW',
      sessions: ['정규'],
      status: randStatus(rnd),
      nxtTradable: rnd() < 0.5,
      listedAt: randDate(rnd),
    });
  }

  // 해외주식 ~1000: NASDAQ/NYSE/AMEX 로테이션, 코드 'USQ' 순번 대역, USD
  for (let i = 0; i < FOREIGN_STOCK_COUNT; i++) {
    const exchange = FOREIGN_EXCHANGES[i % FOREIGN_EXCHANGES.length];
    const code = `USQ${10000 + i}`;
    out.push({
      assetClass: '해외주식',
      exchange,
      code,
      name: `해외기업${String(i + 1).padStart(4, '0')}`,
      currency: 'USD',
      sessions: ['정규', '프리마켓'],
      status: randStatus(rnd),
      listedAt: randDate(rnd),
    });
  }

  // 해외파생: 실명 위주 하드코딩 목록 + 거래소/통화 매핑
  for (const [code, name, exchange, currency] of FOREIGN_DERIV) {
    out.push({
      assetClass: '해외파생',
      exchange,
      code,
      name,
      currency,
      sessions: ['주간', '야간'],
      status: randStatus(rnd),
      listedAt: randDate(rnd),
    });
  }

  // 국내파생: KRX 고정
  for (const [code, name] of DOMESTIC_DERIV) {
    out.push({
      assetClass: '국내파생',
      exchange: 'KRX',
      code,
      name,
      currency: 'KRW',
      sessions: ['정규', '야간'],
      status: randStatus(rnd),
      listedAt: randDate(rnd),
    });
  }

  // 금현물: 미니금 1건 추가
  out.push({
    assetClass: '금현물',
    exchange: 'KRX',
    code: 'GOLD10',
    name: 'KRX 미니금',
    currency: 'KRW',
    sessions: ['정규'],
    status: randStatus(rnd),
    listedAt: randDate(rnd),
  });

  return out;
}

// 신규상장 풀 — 마스터와 코드 대역 분리('9'/'NEW' 접두)
export const NEW_LISTING_POOL: Instrument[] = [
  ...Array.from({ length: 20 }, (_, i) => ({
    assetClass: '국내주식' as AssetClass,
    exchange: 'KRX',
    code: String(900000 + i),
    name: `신규상장국내${String(i + 1).padStart(3, '0')}`,
    currency: 'KRW',
    sessions: ['정규'],
    status: '정상' as const,
    nxtTradable: i % 2 === 0,
    listedAt: '2026-07-01',
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    assetClass: '해외주식' as AssetClass,
    exchange: FOREIGN_EXCHANGES[i % FOREIGN_EXCHANGES.length],
    code: `NEWUS${String(i + 1).padStart(4, '0')}`,
    name: `신규상장해외${String(i + 1).padStart(3, '0')}`,
    currency: 'USD',
    sessions: ['정규', '프리마켓'],
    status: '정상' as const,
    listedAt: '2026-07-01',
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    assetClass: '해외파생' as AssetClass,
    exchange: 'CME',
    code: `NEWFX${String(i + 1).padStart(2, '0')}`,
    name: `신규상장선물${String(i + 1).padStart(2, '0')}`,
    currency: 'USD',
    sessions: ['주간', '야간'],
    status: '정상' as const,
    listedAt: '2026-07-01',
  })),
];
