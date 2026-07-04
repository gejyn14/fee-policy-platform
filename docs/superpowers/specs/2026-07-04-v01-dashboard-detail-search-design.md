# v0.1 — 대시보드 룰 상세·검색 + UX High/Medium 수정 설계

- 작성일: 2026-07-04
- 전제: v0 프로토타입(main, `7b185ab`) 위에 증분. 구현은 별도 세션에서.
- 근거: 2026-07-04 UX 리뷰(High 3건, Medium 4건 채택) + 사용자 요구(룰 상세 조회, 이벤트 검색)

## 1. 룰 상세 조회 — 공용 RuleDetail + 대시보드 행 확장

**신규 `src/screens/RuleDetail.tsx`** (공용 표시 컴포넌트, props: `rule: FeeRule`):
- 기본정보: 이름·유형(한글 병기)·적용형태·기간·기안자
- 적용범위 요약: 상품군/거래소/품목 수/제외 수 (Approvals.tsx의 기존 마크업 이동)
- 요율표 구성요소 테이블 (회사부담 라인 warn 강조, Approvals에서 이동)
- 검증 배지 3종 (아래 2.1의 판정불가 통일 로직 포함)
- 대상 요약 (Dashboard의 기존 대상 컬럼 로직 재사용)
- log 이력 목록

**대시보드**: 행 클릭 → 해당 행 아래 colSpan 확장 행에 `<RuleDetail>` 렌더 (Negotiated.tsx의 log 펼침과 동일 패턴, 한 번에 1개만 펼침). **승인함**: 카드 본문을 `<RuleDetail>`로 교체하고 결재 버튼·반려 input만 유지 — 기존 중복 마크업 제거.

## 2. UX High 3건

### 2.1 품목 0개 상신 차단 + 판정불가 배지 통일
- `Wizard.tsx` `canProceed2`: `itemsSel.length > 0` 추가. 제외 목록 때문에 실질 매칭 0이 될 수 있으므로 2단계에서 "매칭 품목 N개" 실시간 카운트 표시, 0이면 다음 비활성.
- `types.ts`: `FeeRule.sim`을 `{ targets: number; saving: number; matchedProducts: number }`로 확장. `useStore.submitRule`이 매칭 품목 수를 기록 (zero-scope 가드 경로는 `matchedProducts: 0`).
- `Approvals.tsx`(→RuleDetail): `matchedProducts === 0`이면 지배관계·역마진 배지 **둘 다** '판정불가' (현재는 지배관계가 ✓로 오도). 기존 mock 룰에는 `matchedProducts`가 없으므로 optional 처리: `undefined`는 정상 판정으로 간주(활성 기존 룰은 검증 통과된 것).

### 2.2 위저드 입력 보존
- 위저드 폼 상태(form + step)를 `useStore`의 `wizardDraft` 슬라이스로 승격. `Wizard.tsx`는 로컬 useState 제거하고 스토어 읽기/쓰기.
- 리셋 시점: 상신 완료 화면에서 "새 이벤트 등록" 클릭, 또는 draft가 없을 때 초기화. 탭 전환·언마운트에는 유지.
- `reset()`(테스트용)은 draft도 초기화.

### 2.3 지배관계 실패 사유 구체화
- `src/domain/dominance.ts`에 추가:
  ```ts
  export interface DominanceFailure { price: number; candidateFee: number; incumbentFee: number }
  export function explainDominanceFailure(candidate, incumbent, sampleExec): DominanceFailure | null
  // probe grid 전 지점에서 candidate > incumbent인 지점 중 차액 최대 지점 반환, 없으면 null
  ```
- `Wizard.tsx` 5단계 실패 메시지: `"6A: 가격 100에서 신규 3,500원 > 기존 '여름 이벤트' 3,000원"` 형태. 동일 (기존룰, 실패 양상) 조합은 품목을 묶어 1줄로 그룹핑.
- 기존 `dominates()`는 변경 없음 (explain은 별도 함수, 실패 시에만 호출).

## 3. 이벤트 검색·필터 (대시보드 승격)

- 대시보드 상단 컨트롤 바: 검색 input + 필터 select 3개(유형/상태/상품군).
- **검색 매칭**: 룰 이름, 룰 ID, **scope의 품목 코드**(products 리스트 및 '\*'일 때 해당 상품군 전 품목 — '\*'는 상품군 라벨로만 매칭, 전 품목 나열 매칭은 하지 않음. 포함 리스트의 코드만 직접 매칭).
- **필터 기본값**: 상태='활성'. 상태 옵션: 전체/활성/승인대기/기안/반려/종료. 유형·상품군: 전체 기본.
- 테이블에 '상태' 컬럼 추가 (pill 스타일 재사용). 요약 카드(활성 이벤트/바인딩/역마진)는 필터와 무관하게 전체 기준 유지.
- 필터링은 전부 클라이언트 메모리 (mock 규모).

## 4. Medium 4건

1. **단위 상시 표시**: 요율표 편집기의 값 input 옆에 rateType에 따른 고정 suffix 라벨(bp/원). placeholder 의존 제거.
2. **CSV 반영 방식 통일**: 품목 CSV도 계좌 CSV처럼 입력 즉시 자동 파싱·반영(버튼 제거), "인식 N건 / 무시 M건" 실시간 카운트 표시.
3. **유형 한글 병기**: 공용 헬퍼 `ruleTypeLabel(type)` → "기본(BASE)" / "이벤트(EVENT)" / "협의수수료(NEGOTIATED)". Dashboard/Approvals(RuleDetail)/Wizard select에 적용.
4. **대시보드 감면액 카드**: 활성 EVENT/NEGOTIATED 룰의 `sim.saving` 합계를 4번째 카드 "예상 감면 누계"로 표시 (sim 없는 룰은 0).

## 5. 테스트

- `explainDominanceFailure`: 역전 지점 정확성(구간표 교차 케이스), 지배 성립 시 null — 단위 테스트.
- `submitRule`의 `matchedProducts` 기록 — 기존 useStore 테스트 확장.
- wizardDraft 보존/리셋 — 스토어 테스트 (set draft → 다른 액션 후 유지 확인 → 리셋).
- 화면(행 확장, 검색 필터)은 기존 관례대로 수동 확인 + 빌드/기존 30 테스트 유지.

## 6. 범위 외 (명시)

- 승인함 위험도순 정렬, 금액 표기 전면 통일(formatWon), 품목 체크리스트 전체선택 — v0.2 후보.
- 원장 스케일 리뷰 Top 5(물질화 전략, 시간축 모델 등)는 문서 개정 별건 — 이 스펙과 무관.
