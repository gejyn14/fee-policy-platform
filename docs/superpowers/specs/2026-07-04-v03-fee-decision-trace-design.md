# v0.3 — 수수료 결정 흐름 (To-Be 로직 trace 워크스루) 설계

- 작성일: 2026-07-04
- 전제: v0.2(branch feature/v0.2-instrument-master, `392bd19`) 위에 증분
- 목적: "체결 시 어느 수수료가 왜 적용되는가"의 **신규 플랫폼(To-Be) 로직 흐름**을 팀장 보고용으로 단계별 시연. 각 단계에서 참조하는 실제 데이터 행(미니 테이블)을 함께 노출.

## 1. 화면 — 신규 탭 "수수료 결정 흐름"

입력부: 계좌 select(4건) + 품목 검색형 단일 선택(수천 건이므로 검색 input + 상위 20 결과 드롭리스트에서 1건 선택; `거래소:코드` 라벨) + (5단계용) 체결가·수량 input.

`[다음 단계]` 버튼으로 ①→⑤ 진행. 지나온 단계는 화면에 남아 체인이 쌓이고, 현재 단계는 강조. `[처음부터]` 리셋. 계좌/품목 변경 시 1단계로 리셋.

| 단계 | 제목 | 내용 (미니 테이블 + 1줄 내레이션) |
|---|---|---|
| ① | 계좌 확인 | ACCOUNT 행 1건: 계좌번호/이름/등급/6개월평균자산/6개월약정액. 내레이션 "계좌의 등급·속성에서 출발하지만, 등급표 직조회가 아니라 이 계좌에 걸린 모든 룰을 본다" |
| ② | 후보 룰 수집 | FEE_RULE 후보 행들(활성 + scope 매칭 + isTarget 통과): 룰ID/이름/유형/적용형태/기간/요율표ID. 탈락 룰도 회색 행으로 1~3건 표시(탈락 사유: scope 불일치/기간 밖/신청 없음) — "왜 후보가 아닌가"까지 보여줌 |
| ③ | 최저가 경쟁 | 후보별: 요율표 이름 + 표본 체결(공동 probe grid 평균) 고객부과액 → 오름차순 정렬, 승자 행 하이라이트 + "최저가" 배지. 동률 시 tie-break(협수>이벤트>기본) 문구 표시 |
| ④ | 확정 바인딩 | FEE_BINDING 행 1건: ACCOUNT_ID/SCOPE_KEY/SCHEDULE_ID/SOURCE_RULE_ID/VALID_FROM~TO/REASON. 내레이션 "원장 체결 경로는 이 한 행 조회로 끝난다 (index-only)" — 실제 스토어 bindings에서 해당 행을 찾아 표시(엔진 산출물과 동일함을 증명) |
| ⑤ | 체결 → 금액 계산 | 체결가·수량 입력 → `calcFee` → 구성요소별 라인(이름/종류/부담주체/금액, 회사부담 warn 강조, 구간표면 적용 구간 표시) + 고객부과 합계/회사부담 합계. 내레이션 "금액은 미리 저장하지 않고 요율표×체결로 즉석 계산해 잔고에 내린다" |

빈 상태: 계좌·품목 미선택 시 안내 문구. ②에서 후보 0건(이론상 BASE가 항상 있어 발생 안 하나 방어)이면 "적용 가능한 룰 없음 — 기본 등급 fallback" 표시.

## 2. 도메인 — `explainBinding()` (핵심, TDD)

`src/domain/binding.ts`에 추가. **rebindAccount와 동일한 선택 규칙**을 결정 과정 전체로 반환하는 순수 함수 — 화면은 그리기만 하고 로직 중복 없음.

```ts
export interface CandidateTrace {
  rule: FeeRule;
  schedule: FeeSchedule;
  avgCustomerFee: number;      // 공동 probe grid 평균 고객부과액 (rebindAccount의 cost와 동일)
  isWinner: boolean;
}
export interface RejectedTrace {
  rule: FeeRule;
  reason: '범위 불일치' | '기간 밖' | '대상 아님';  // scope/기간/isTarget 탈락
}
export interface BindingTrace {
  candidates: CandidateTrace[];   // 비용 오름차순
  rejected: RejectedTrace[];      // 관련 있으나 탈락한 룰 (같은 상품군의 비후보)
  binding: FeeBinding | null;     // 승자로부터 구성 (rebindAccount 산출과 동일 형태)
  tieBreakApplied: boolean;       // 최저가 동률로 tie-break가 실제 작동했는지
}
export function explainBinding(
  acct: Account, product: Product, rules: FeeRule[], schedules: FeeSchedule[],
  enrollments: Enrollment[], today: string,
): BindingTrace
```

- 구현은 `rebindAccount`의 내부 로직(활성 필터→scopeMatches→isTarget→공동 probe grid 평균 비교→tie-break)을 **공유 헬퍼로 추출**해 양쪽이 같은 코드를 쓰도록 리팩터 (동작 불변 — 기존 binding 테스트 전부 유지가 증거).
- rejected는 같은 상품군(scope.assetClass 일치) 룰 중 후보 탈락분만, 탈락 사유 우선순위: 기간 밖 > 범위 불일치 > 대상 아님.

## 3. 검증

- `explainBinding` TDD: 승자가 rebindAccount 바인딩과 일치(기존 mock 케이스), tie-break 케이스에서 tieBreakApplied=true + 협수 승, rejected 사유 3종 각각.
- 리팩터 안전망: 기존 binding/e2e 테스트 61건 전부 유지.
- 화면은 기존 관례(수동 확인 + 빌드).

## 4. 범위 외

- as-is(등급 직조회) 대조 뷰, 매체 차원 trace, 애니메이션, 단계 자동 재생.
