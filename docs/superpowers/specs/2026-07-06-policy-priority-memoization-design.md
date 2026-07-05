# v0.9 정책 우선순위 메모이즈 — 룰 변경 시에만 재산정하는 인메모리 인덱스

> 상태: 확정(2026-07-06). 근거: v0.8이 규정한 "룰 변경 때만 미리 산정"을 실제 구현이 지키도록, 우선순위 인덱스를 스토어에 메모이즈하고 룰/요율표 변경 시에만 무효화한다.

## 배경 — 문서와 구현의 갭

v0.8 스펙(`2026-07-05-v08-policy-priority-precompute-design.md`)은 정책 우선순위 인덱스를 **"룰 변경 때만" 미리 산정**하고 체결 시에는 룩업만 한다고 규정했다. 그러나 현재 구현(`src/store/useStore.ts:86`, `:208`)은 `resolveFee`·`policyPriority()`가 호출될 때마다 `buildPolicyPriority(...)`를 새로 돌린다 — precompute가 아니라 매 호출 recompute다. 리졸브 캐시 미스마다 전체 룰을 filter+map+**sort**(O(N log N))하는 비용이 반복된다.

이 스펙은 그 갭을 닫는다: 인덱스를 한 번 만들어 재사용하고, 룰/요율표가 바뀔 때만 버린다.

## 불변식(왜 안전한가)

정렬된 우선순위 인덱스(`policies` + 각 `rank`)는 순수하게 **`(rules, schedules, today)`의 함수**다. 계좌·체결가와 무관하다(v0.8 통찰: 같은 feeKey 안에서 승자는 가격 무관). 따라서:

- 같은 `(rules, schedules, today)`면 인덱스는 불변 → 안전하게 재사용 가능.
- 계좌별 판정(`isTarget`·`isBenefitActive`)은 인덱스가 아니라 `winnerFor` **조회 시점**의 O(N) 스캔에서 이뤄지므로, 인덱스 자체는 계좌와 무관하게 공유된다.
- 협의(nego)는 인덱스에 들어가지 않고 `resolve`에서 별도 오버레이로 처리된다 → nego 변경은 인덱스에 영향 없음.

## 설계

### 저장 메커니즘 — 모듈 스코프 메모 슬롯

`resolveCache`와 나란히 `useStore.ts` 모듈 스코프에 lazy 메모 슬롯을 둔다.

```ts
let priorityIdx: PolicyPriorityIndex | null = null;

// 룰/요율표에서 파생된 계좌 무관 순위. 없으면 빌드, 있으면 재사용.
function getPriorityIndex(s: State): PolicyPriorityIndex {
  return priorityIdx ??= buildPolicyPriority(s.rules, s.schedules, TODAY);
}
```

- `resolveFee`(`:86`): `buildPolicyPriority(...)` 직접 호출 → `getPriorityIndex(s)`로 교체.
- `policyPriority()`(`:208`): `getPriorityIndex(s)` 사용.
- **무효화 = `priorityIdx = null`** (다음 읽기에서 lazy 재빌드). `resolveCache`와 동일 철학이며, 인덱스와 계좌축 캐시의 **2단 캐시** 구조를 완성한다.

`buildPolicyPriority`·`rankKey`·`PolicyPriorityIndex`(`src/domain/policyRank.ts`)의 시그니처·로직은 변경하지 않는다. 이 스펙은 순수하게 스토어의 호출·수명 관리 변경이다.

### 무효화 지점

`rules` 또는 `schedules`를 바꾸는 mutation에서만 `priorityIdx = null`.

| Mutation | 인덱스 영향 | 무효화 |
|---|---|---|
| `approveRule` | 룰 → 활성(순위 편입) | O |
| `batchActivateExpireRules` | 날짜 기준 활성↔만료 플립 | O (프로토타입의 "날짜 롤오버"가 이걸로 모델됨) |
| `submitRule` | 승인대기 룰 + 요율표 추가/치환 | O (요율표 변경 포함, 안전차원) |
| `addSchedule` | 요율표 rank 변동 가능 | O |
| `extendNegotiated` | 룰 endDate → 기간 게이트 변동 | O |
| `rejectRule` | 승인대기→반려(비활성이라 무영향) | O (안전차원, 저비용) |
| `reset` | 전체 초기화 | O |
| `approveNegoRequest`·`submitNegoRequest`·`rejectNegoRequest`·`applyNegoExtension` | `nego` 배열만(계좌 오버레이) | X |
| `syncFromLedger`·`registerInstruments` | instruments/products(인덱스 무의존) | X |

**포인트**
- 협의(nego) 계열은 인덱스와 무관 — 이미 `resolve`에서 오버레이로 처리되므로 순위 인덱스를 건드릴 필요 없다. 기존의 `resolveCache.invalidateAccount(...)` 처리는 그대로 둔다.
- 날짜 롤오버: `TODAY`가 상수라 세션 중 저절로 stale되지 않고, 배치가 status를 플립할 때 `rules` 변경으로 자연히 무효화된다 → 프로토타입에선 **별도 날짜 타이머 불필요**.

## 저장 정책 — 전용 테이블을 만들지 않는 이유

계좌 무관 우선순위 인덱스는 **전용 영속 테이블(예: `FEE_POLICY_PRIORITY`)로 만들지 않는다.** 근거:

1. **이중 진실원 회피** — 인덱스는 `FEE_RULE`/`FEE_SCHEDULE`의 순수 파생값이다. 테이블로 굳히면 원본 변경마다 동기화·정합성 부담이 생긴다.
2. **비싼 축은 계좌축** — 영속이 값어치 있는 건 O(계좌×feeKey)인 `FEE_BINDING`이다. 정책 순위는 O(룰 수)로 작아 앱/잡 메모리 재빌드가 더 싸다.
3. **"원장은 룰을 모른다" 원칙** — 순위는 플랫폼 내부 로직이며, `table-design.md` 4.7절이 규정하듯 `FEE_BINDING`에는 결과만 남는다.

**예외(그때 테이블이 정당화됨):** 플랫폼을 다중 인스턴스로 수평 확장(로컬 캐시 정합성 문제)하거나, feeKey별 순위를 시점별로 감사/재현하거나 화면을 DB에서 직접 먹여야 할 때. 이번 범위는 **단일 플랫폼 프로세스** 전제이므로 해당 없음.

## 프로덕션 매핑

우선순위 인덱스는 프로덕션에서 "오래 사는 전역 캐시"가 아니라 **rebind(바인딩) 잡 스코프의 transient 산출물**이 된다. 체결(hot path)은 인덱스를 건드리지 않고 원장이 `FEE_BINDING`만 읽는다.

```
[룰 변경/승인] → rebind 잡 실행
                 ├─ 우선순위 인덱스 계산 (잡 스코프, 잡 종료 시 소멸)
                 ├─ 계좌별 승자 확정
                 └─ FEE_BINDING UPSERT   ← 영속 저장(계좌축 결과)
[체결] → 원장이 FEE_BINDING 룩업 → 끝
```

| | 프로토타입(현재 레포) | 프로덕션 |
|---|---|---|
| 우선순위 인덱스 | 스토어 메모이즈(전역, lazy) | rebind 잡 스코프(transient) |
| 계좌축 결과 저장 | `ResolveCache`(인메모리 Map) | `FEE_BINDING` 테이블 |
| 무효화 트리거 | 룰 변경 + (배치가 대변하는) 날짜 | 룰 변경 이벤트 → rebind + 일배치(날짜 롤오버) |

패턴("파생값, 룰 변경 때 재계산")은 프로덕션까지 그대로 살아남고, 저장 메커니즘만 "프로세스 로컬 Map → 잡 스코프 계산 + `FEE_BINDING` 영속"으로 바뀐다.

## 테스트

1. **메모이즈**: 같은 상태로 `resolveFee`를 2회 호출 → `buildPolicyPriority`가 재호출되지 않음(스파이 또는 인덱스 참조 동일성).
2. **무효화 정확성**: `approveRule`로 더 싼 룰을 활성화 → 다음 리졸브에서 승자가 갱신됨.
3. **비무효화(회귀 방지)**: `approveNegoRequest` 후 인덱스 참조가 동일(협의는 인덱스 무영향)하고, 계좌축 캐시만 무효화됨.
4. **등가성**: 메모된 인덱스의 winner == 매번 새로 빌드한 인덱스의 winner(기존 `resolve` 정합성 유지).

## 범위

**포함**
- `src/store/useStore.ts`: 메모 슬롯 + `getPriorityIndex` 도입, `resolveFee`·`policyPriority` 교체, 무효화 매트릭스 반영.
- 테스트 4종 추가(스토어/도메인/e2e 중 적절한 위치).
- 문서 동기화:
  - `2026-07-05-v08-...md`: 구현이 "룰 변경 시 무효화 + lazy 재빌드"임을 반영, 날짜 롤오버 무효화 축 caveat, 프로덕션 매핑 절 추가.
  - `table-design.md`: 4.7절 근처에 "계좌 무관 우선순위는 전용 테이블 없이 플랫폼 인메모리 파생값, 영속은 `FEE_BINDING`(계좌축)이 담당" 결정 명시.

**범위 밖**
- `policyRank.ts`의 랭킹 알고리즘·시그니처 변경.
- `FEE_POLICY_PRIORITY` 등 전용 테이블 신설.
- 다중 인스턴스 캐시 정합성(공유 캐시/분산 무효화).
- `resolve`의 probe-grid 로직 대체(정합성만 유지).
