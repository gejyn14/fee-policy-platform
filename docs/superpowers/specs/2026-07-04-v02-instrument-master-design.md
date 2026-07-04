# v0.2 — 종목 마스터 연동 + 상품군별 차원 관련성 + 대량 선택 UX 설계

- 작성일: 2026-07-04
- 전제: v0.1(branch feature/v0.1-dashboard-search, `e4897b0`) 위에 증분
- 배경: 실 상품 세계는 종목이 수천 개다. 위저드의 체크박스 나열은 성립하지 않고, 종목 정보는 원장에서 와야 하며(가상 연동으로 시뮬레이션), 거래소라는 차원의 성격이 상품군마다 다르다.

## 1. 핵심 도메인 결정

### 1.1 거래소 차원의 성격은 상품군마다 다르다 (차원 관련성 매트릭스)

| 상품군 | 거래소 | 세션 | 통화 | 품목 단위 |
|---|---|---|---|---|
| 국내주식 | **선택 차원** — 같은 종목이 KRX/NXT 병행 거래, "NXT 거래만 할인" 성립 | 선택(정규/시간외) | 숨김(KRW 고정) | 종목 |
| 해외주식 | **종목의 속성** — 픽커 내 필터 chip으로만 | 선택(정규/프리/애프터) | 숨김(종목 속성) | 종목 |
| 해외파생 | **품목의 속성** — 픽커 내 필터 chip. "CME 전체" 선택 시 `scope.exchanges=['CME']`로 반영(스펙 v0의 "CME 전체, 6E 제외" 패턴 유지) | 선택(주간/야간) | 숨김(품목 속성) | 품목(기초자산) |
| 국내파생 | **숨김**(KRX 고정) | 선택(정규/야간) | 숨김(KRW) | 품목(상품) |
| 금현물 | **숨김**(KRX 고정) | 숨김(정규만) | 숨김(KRW) | 품목 |

### 1.2 상품군 선택은 1단계(기본정보)로 이동

위저드 1단계에서 상품군을 고르면 2단계(적용범위)가 매트릭스대로 조건 렌더된다. 2단계의 상품군 select는 제거.

### 1.3 국내주식 NXT 병행은 (종목×거래소) Product 확장으로 — 엔진 무수정

Instrument는 종목당 1건(`nxtTradable` 플래그), 엔진이 쓰는 `Product[]`는 파생 시 NXT 병행 종목을 `KRX:005930` + `NXT:005930` 두 건으로 확장한다. `scopeMatches`/`rebindAccount`/`FeeBinding.scopeKey` 전부 무수정으로 "NXT만 할인" 이벤트가 성립한다. 바인딩이 계좌×수천 조각으로 커지는 것은 의도된 결과("전체 물질화"의 스케일 체감 — 실 설계에서 예외 물질화가 필요한 이유의 라이브 데모).

## 2. 종목 마스터 (가상 원장 연동)

### 2.1 데이터 모델

```ts
interface Instrument {
  assetClass: AssetClass;
  exchange: string;            // 소속 거래소 (국내주식은 'KRX')
  code: string; name: string;
  currency: string;
  sessions: string[];
  status: '정상' | '거래정지' | '상장폐지';
  nxtTradable?: boolean;       // 국내주식 전용
  listedAt: string;            // 'YYYY-MM-DD'
}
```

### 2.2 결정적 생성기 — `src/masterdata/instruments.ts`

시드 기반(입력이 같으면 항상 같은 출력, `Math.random` 금지) ~3,000건:
- 국내주식 ~1,800 (KRX, 그중 NXT 병행 ~900, 거래정지 ~20, 상장폐지 ~10)
- 해외주식 ~1,000 (NASDAQ/NYSE/AMEX, USD)
- 해외파생 품목 ~45 (CME/EUREX/SGX/HKEX — 6A·6B·6E·ES·NQ·FDAX 등 실명 위주)
- 국내파생 품목 ~15 (KOSPI200선물/옵션·미니·위클리·주식선물·국채선물 등)
- 금현물 2
- **레거시 6코드(005930, AAPL, K200OPT, 6A, 6B, GOLD99)는 동일 속성으로 반드시 포함** — 기존 테스트 35건 안정성의 전제.
- 별도로 **신규상장 풀 ~30건**(마스터에 없는 종목, 동기화 시뮬레이션용)을 export.

### 2.3 Product 파생 — `src/masterdata/derive.ts`

`deriveProducts(instruments: Instrument[]): Product[]` — 상장폐지 제외, 국내주식 NXT 병행은 거래소별 2건 확장(NXT Product의 sessions는 NXT 세션). 거래정지는 포함(이벤트 기간 중 재개 가능)하되 화면에서 배지.

### 2.4 스토어 통합

- `instruments: Instrument[]` 상태 추가. `products`는 instruments에서 파생(승격: 기존 정적 mockProducts 대체, 파생 결과 메모이즈).
- `syncFromLedger(): { added: number }` — 신규상장 풀에서 앞 N건(결정적)을 instruments에 append → products 재파생 → `rebindAll()`. 호출할 때마다 풀의 다음 구간이 유입, 소진 시 0건.
- `registerInstruments(rows: Instrument[]): void` — CSV 등록분 append(중복 코드는 거부) → 재파생 → rebindAll.

### 2.5 종목 마스터 화면 — `src/screens/InstrumentMaster.tsx` (신규 탭)

- 검색(코드/이름) + 상품군/거래소/상태 필터, 표시 cap 100 + "그 외 N건 — 검색으로 좁히세요"
- 요약 카드: 총 종목 수, 상품군별 수, 거래정지 수
- CSV 등록: `코드,이름,상품군,거래소,통화` 붙여넣기 → 검증(필수값·상품군 enum·중복 코드) → 미리보기(수용/거부 사유) → [등록]
- [원장 동기화] 버튼 → `syncFromLedger()` → "신규 상장 N건 유입" 토스트/알림 영역 + 유입 종목 목록 표시. 유입 후 대시보드 바인딩 카드 수가 늘어나는 것이 "신규 상장 트리거" 데모.

## 3. 대량 선택 UX — 공용 `InstrumentPicker` (듀얼 패널)

`src/screens/InstrumentPicker.tsx` — 위저드 2단계에서 사용. props: `assetClass`, `value: { products: string[] | '*'; excludeProducts: string[]; exchanges: string[] | '*' }`, `onChange`.

**좌측(후보 탐색)**:
- 검색 input(코드/이름) + 거래소 filter chip(해외주식/해외파생: "CME(12)" 형태 카운트 병기) + 상태 filter
- 결과 리스트 cap 100(초과 시 "N건 더 — 검색으로 좁히세요"), 행 클릭=선택 토글, 거래정지/상장폐지 배지
- **[검색결과 전체 선택]** — cap과 무관하게 현재 조건의 전체 코드를 선택에 반영
- **[거래소 전체 선택]** (해외파생/해외주식) — 개별 코드 나열 대신 `products='*'` + `exchanges=[해당 거래소]` 모드로 전환 ("CME 전체" 패턴)
- CSV 붙여넣기 textarea + [반영] — 인식 N건/무시 M건 표시 후 선택상태에 **merge** (입력 수단일 뿐, 이후 진실은 선택상태)

**우측(선택 결과)**:
- 모드 표시: `전체(*)` / `전체(*) + 제외 M건` / `지정 N건`
- 선택 chip 목록(cap 50 + "외 N건") — chip의 ×로 **개별 제거** (v0.1의 "CSV 인식분 해제 불가" Minor 해소: 선택은 단일 상태이므로 무엇으로 넣었든 제거 가능)
- 제외 chip 목록 동일 패턴 (전체(*) 모드에서 좌측 행 클릭=제외 토글)
- [전체 대상으로 전환] / [모두 지우기]

**위저드 통합**: 기존 2단계의 체크박스 그리드+CSV textarea 제거, InstrumentPicker로 대체. `effectiveItemsSel` render-union 제거(선택상태 단일화). 매칭 품목 카운트·지배관계 검증·시뮬레이션은 선택상태에서 동일하게 파생.

## 4. 파급 조정

- **계좌 조회**: 바인딩이 계좌당 수천 건 → 검색 input + 표시 cap 50 추가.
- **대시보드**: 바인딩 카드는 실수치 그대로(스케일 체감). 렌더 목록엔 영향 없음(룰 단위).
- **성능**: rebindAll이 4계좌×~4,000 Product — 계측 테스트로 상한 확인(< 2초 목표, 초과 시 콘솔 경고가 아니라 테스트 실패). products 파생·픽커 필터링은 useMemo.
- **기존 테스트**: 레거시 6코드 보존으로 35건 유지가 원칙. sim.targets/바인딩 수를 정확 수치로 단언하는 테스트가 있으면 조건부(≥) 단언으로 조정 허용(계획서에 명시).

## 5. 검증 전략 (TDD 대상)

- 생성기: 총량·상품군 분포·레거시 6코드 포함·결정성(두 번 호출 동일) 
- deriveProducts: NXT 확장 2건·상장폐지 제외·거래정지 포함
- syncFromLedger: 결정적 유입·소진 시 0·rebind 동반
- registerInstruments: 중복 거부·정상 append
- CSV 파서(마스터용): 필드 검증·enum 검증
- InstrumentPicker 선택 로직(순수 함수로 분리): 전체(*)↔지정 전환, 제외 토글, 검색결과 전체 선택
- 성능 계측: rebindAll 상한

## 6. 범위 외

- 종목 상태 변경 UI(거래정지 처리 등) — 원장 몫, 조회만
- 가상 스크롤 라이브러리 — cap+검색으로 대체(YAGNI)
- 예외만 물질화 전환 — 실 시스템 설계 문서 개정 별건
- NXT 호가/수수료 체계 차이의 정밀 모델링 — 요율표는 기존 모델 그대로
