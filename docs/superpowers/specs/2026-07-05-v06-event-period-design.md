# v0.6 이벤트 기간 2축 설계 — 신청/유입 가능기간 vs 적용기간(혜택 기간)

> 상태: 확정(2026-07-05 브레인스토밍 승인). 개발 A. 후속: 협의수수료 연장(개발 B)은 별도 스펙.

## 목표

이벤트 기간을 **두 축**으로 분리한다.

- **신청/유입 가능기간**: 계좌가 이벤트에 들어올 수 있는 캘린더 구간(현 룰의 `startDate~endDate`가 이 역할).
- **적용기간(혜택 기간)**: 실제 우대가 적용되는 구간. 룰마다 택1:
  - **캘린더 고정**: 룰 종료일까지(현행과 동일, 기본값).
  - **유입시점 상대**: 계좌별 **가입일 + N개월**. 예) "가입 시 두 달 무료".

일괄적용형은 신청 개념이 없으므로 `startDate~endDate`가 곧 적용기간(캘린더 고정).

## 현재 상태와 갭

- `FeeRule.startDate/endDate` 한 쌍이 유일한 기간 표현. `isActive(r, today) = 활성 && start<=today<=end`가 룰 전체를 캘린더로 게이팅한다(`resolve.ts`).
- `Enrollment { accountId, ruleId, enrolledAt, channel }` — **가입일(enrolledAt)이 이미 존재**하나, 해석에서 계좌별 기간 계산에 쓰이지 않는다.
- `resolve()`는 `isTarget(r, acct, [])`로 **빈 가입 이력**을 넘겨(`resolve.ts:74`) 신청형 멤버십을 사실상 판정하지 못한다(신청형은 항상 탈락). 가입형은 "전 계좌 가입 간주"로 통과.
- 결과적으로 "가입일 기준 N개월" 같은 계좌별 혜택 기간을 표현할 수 없다.

이 스펙은 (1) 룰에 적용기간 유형을 추가하고, (2) 해석이 가입 이력을 물게 하며(현재 누락분 정정), (3) 계좌별 "혜택 유효" 판정을 도입한다.

## 결정성 제약(기존 유지)

- `Math.random`/`Date.now`/인자 없는 `new Date()` 금지. 기준일 `TODAY` 고정.
- 상대기간 계산에 필요한 월 덧셈은 **순수 결정적 헬퍼**로 구현(`new Date(y, m, 0)`처럼 인자 있는 형태는 허용 — 월말 클램프에만 사용).
- 상대기간 혜택은 시간이 지나면 만료되나, 프로토타입은 `TODAY` 고정이라 정적. 실환경의 시간 경과 만료 시 캐시 무효화는 **범위 밖**(문서에 명시).

## 데이터 모델

```ts
// types.ts
export type BenefitPeriod =
  | { kind: '캘린더' }                    // 신청 가능기간(룰 캘린더)과 동일하게 적용
  | { kind: '상대'; months: number };     // 가입일 + months 개월

export interface FeeRule {
  // ...기존 필드 유지...
  benefit?: BenefitPeriod;                // 미지정 = { kind: '캘린더' } (하위호환)
}
```

- 기존 룰(benefit 미지정) = 캘린더 → **동작 불변**.
- `Enrollment.enrolledAt`(기존) = 상대기간 기준일. 상대형 룰은 계좌별 가입 이력을 **요구**한다(가입형이라도). 즉 상대 혜택의 멤버십·가입일 출처는 항상 가입 이력.

## 도메인 로직

### 순수 날짜 헬퍼 (신규 `src/domain/dateutil.ts`)

```ts
export function addMonths(dateStr: string, n: number): string; // 'YYYY-MM-DD' + n개월, 월말 클램프
```
- `addMonths('2026-07-04', 2) === '2026-09-04'`
- `addMonths('2026-01-31', 1) === '2026-02-28'` (월말 클램프)
- `addMonths('2026-11-30', 3) === '2027-02-28'`

### 혜택 유효 판정 — 멤버십(누가)과 시간(언제) 분리

**멤버십(누가)** 은 기존 `isTarget`이 그대로 담당한다(변경 없음): 신청형=가입 이력 존재, 가입형=전 계좌 간주, 휴면복귀형=`dormantReturned`, 그리고 `condition`(협수 게이트) AND. 이 스펙은 여기에 손대지 않는다.

**시간(언제)** 만 신규 `isBenefitActive`가 담당한다 — 오버레이 후보를 캘린더로만 게이팅하던 `isActive`를 대체:

```ts
export function isBenefitActive(
  rule: FeeRule, acct: Account, enrollments: Enrollment[], today: string
): boolean;
```

| benefit(룰) | 유효(시간) 조건 |
|-------------|----------------|
| 캘린더 (또는 일괄적용형) | `start <= today <= end` |
| 상대(N) | 해당 룰 가입 이력의 `enrolledAt` 존재 **AND** `enrolledAt <= today <= addMonths(enrolledAt, N)` |

- 캘린더형은 기존과 동일한 시간 게이트라 **가입형 "전 계좌 간주" 동작 불변**(멤버십은 isTarget이 처리).
- 상대형은 계좌별 `enrolledAt`이 필요하므로 가입 이력이 없는 계좌는 시간 게이트에서 자연히 탈락(가입형이라도). 즉 상대 혜택은 가입 이력을 사실상 요구.
- **상대형은 `end`(신청 마감) 이후여도 유효**할 수 있다 — 가입일+N이 지나기 전까지. 이것이 핵심 동작.

### resolve 통합

- `resolve(acct, key, rules, schedules, nego, index, today, enrollments)` — `enrollments` 인자 추가.
- 이벤트 후보 채택: `isTarget(r, acct, enrollments) && isBenefitActive(r, acct, enrollments, today)`. (isTarget에 실제 enrollments 전달 — 현재 빈 배열 정정.)
- `buildScopeIndex`: 오버레이 후보를 **`status === '활성'`만으로** 필터(캘린더 날짜 게이트 제거). 시간 게이팅은 resolve의 `isBenefitActive`가 계좌별로 수행 — 상대형이 `end` 이후에도 후보로 남게 하기 위함. BASE는 기존 `isActive`(캘린더) 유지.
- `store.resolveFee`가 `s.enrollments`를 resolve에 전달. 캐시 키는 (계좌, feeKey)라 계좌별 상대기간 차이가 자연히 반영됨.

## 화면

- **이벤트 등록 1단계**: "적용기간 유형" 선택 추가 — {캘린더 고정 / 유입시점 +N개월}. 상대 선택 시 개월 수 입력. 날짜 필드 라벨을 신청/가입형일 때 "신청 가능기간"으로 표기(일괄적용형은 "적용기간" 유지).
- **계좌 조회 · 수수료 결정 흐름**: 승자 후보가 상대형 이벤트면 혜택 근거(가입일 · 만료 예정일 = 가입일+N · 남은 개월)를 표시.
- **대시보드/위저드 시뮬레이션**: 상대형 이벤트는 "적용기간: 가입일+N개월"로 표기(캘린더 구간이 아님).

## Mock

- 상대형 이벤트 시연 룰 1개 추가: 예) "신규 온라인 가입 2개월 무료"(국내주식, 채널 HTS/MTS, benefit `{ 상대, months: 2 }`).
- 해당 룰에 대한 가입 이력(enrolledAt) 2~3건 시드: 하나는 아직 혜택 유효(가입 최근), 하나는 만료(가입 3개월 전) → 결정 흐름에서 유효/만료 대비 시연.
- 기존 mock 룰은 benefit 미지정(캘린더) 유지.

## 테스트 계획

- `dateutil.test.ts`: addMonths 기본/월말 클램프/연도 넘김.
- `resolve`(또는 신규 `benefit.test.ts`):
  - 캘린더형 신청 이벤트: 가입 이력 있으면 채택, 없으면 탈락.
  - 상대형: 오늘이 [가입일, 가입일+N] 안이면 채택, 지나면 탈락. **신청 마감(end) 이후여도 유효** 케이스 명시.
  - 일괄적용형: 기존 동작 불변(회귀).
- `useStore.test.ts`: resolveFee가 상대형 이벤트를 가입일 기준으로 적용/만료하는 캐스케이드.
- 기존 e2e/도메인 테스트 회귀 통과(benefit 미지정 = 캘린더 불변).

## 범위 밖

- 시간 경과에 따른 상대기간 만료 → 캐시 자동 무효화(프로토타입 TODAY 고정).
- 상대기간 단위 "일"(현재 개월만). 필드 구조는 확장 여지 남김.
- 신청 가능기간과 별개의 하드 백스톱 종료일(상대 혜택은 가입일+N을 온전히 보장).

## Self-Review 메모

- 하위호환: benefit 미지정 → 캘린더 → 기존 룰/테스트 불변. 확인.
- 결정성: addMonths 순수, TODAY 고정. Date.now/argless new Date 미사용.
- 통합 위험: buildScopeIndex 날짜 게이트 제거로 후보 수가 늘 수 있으나 프로토타입 규모에서 무해, 시간 게이팅은 resolve로 이동.
