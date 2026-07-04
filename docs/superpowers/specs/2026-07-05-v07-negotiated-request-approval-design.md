# v0.7 협의수수료 신청·승인 재설계 — 계좌 단위 신청 → 자격확인 → 요청 → 승인

> 상태: 확정(2026-07-05 브레인스토밍 승인). 협의를 이벤트 위저드에서 분리.

## 목표

협의수수료를 이벤트와 분리해 **계좌 단위 신청 흐름**으로 만든다.

- 협의 신청 = **적용범위 + 요율표(표준 선택 후 수정) + 계좌번호 리스트** 입력 → 계좌별 **자격 자동판정** → **협수 요청**
- 승인 = **별도 탭**에서 요청 목록(계좌번호·자격상태) 확인 → **승인/반려**. 승인 시 협의 활성화
- 자격 = **상품군별 표준 기준** 자동확인 + **영업 bypass(사유)** 예외
- 이벤트 등록 위저드는 **EVENT 전용**으로 정리(협의명·조건 입력 제거)

## 현재 상태와 갭

- 위저드가 EVENT·NEGOTIATED를 함께 다룸 — 협의에 이벤트명·기간을 넣는 부자연스러움.
- 협의 grant(`NegoException`)는 배치(`batchEvalNegotiations`, NEGOTIATED 룰 + 가입 이력 + 조건)로 생성 — 계좌 단위 신청 개념 부재.
- 해석(`resolve`)은 grant를 `nego` 후보로 쓰되, NEGOTIATED 룰도 오버레이 인덱스(`type !== 'BASE'`)에 섞여 `event` 후보로 잡히는 군더더기.

## 결정성 제약(기존 유지)

- `Math.random`/`Date.now`/인자 없는 `new Date()` 금지. 기준일 `TODAY='2026-07-04'`.
- 유효기간·승인일은 `TODAY`/`addMonths` 기반. 신청/승인 이력의 시각은 `TODAY` 문자열로.

## 데이터 모델

**협의(grant)에 상태·자격 필드 추가** — 별도 요청 엔티티 없이 grant에 라이프사이클을 얹는다.

```ts
// NegoException(협의) 확장
export interface NegoException {
  accountId: string; scope: ScopeSelector; scheduleId: string;
  validFrom: string; validTo: string;
  status: '요청' | '활성' | '반려';        // 신규
  qualify: '충족' | '예외';                // 신규: 예외=영업 bypass
  reason?: string;                         // 신규: bypass/반려 사유
  requestId: string;                       // 신규: 한 신청(계좌 리스트) 묶음 식별
  requestedBy: string; requestedAt: string;// 신규
  approvedAt?: string;                     // 신규
}
```

**협의 자격 정책** — 상품군별 표준 기준(참조 데이터, 현업 설정은 범위 밖·시드로).

```ts
// types.ts
export interface QualifyPolicy { assetClass: AssetClass; metric: NegotiatedCondition['metric']; threshold: number }
// mock: 예) 해외주식 6개월평균자산 5억, 해외파생 6개월약정액 1억 등
```

- 신청 시 요율표를 "선택 후 수정"하면 **새 요율표를 복제 생성**(원본 불변). 요청별 고유 scheduleId.
- 기존 NEGOTIATED `FeeRule`은 **제거**. 자격 기준은 `QualifyPolicy`가 대체.

## 도메인 로직

### 자격 판정 (신규 `src/domain/qualify.ts`)

```ts
export function qualifyOf(policies: QualifyPolicy[], assetClass: AssetClass, acct: Account): { met: boolean; policy: QualifyPolicy | null };
// 정책의 metric(6개월평균자산/약정액) 값 >= threshold 이면 met=true. 정책 없으면 met=true(기준 없음).
```

### 해석(resolve) 정리

- 오버레이 인덱스(`buildScopeIndex`)를 `type === 'EVENT'`만 포함(NEGOTIATED 제거).
- `nego` 후보 = grant 중 **`status === '활성'` && 기간 내**만(요청/반려 제외). resolve의 nego 루프에 status 필터 추가.

### 연장 리뷰(개발 B) 적응 — `classifyNegoExtension`

- 입력을 NEGOTIATED 룰 대신 **활성 grant + QualifyPolicy**로 전환.
- 그룹 축은 유지: 주식형=상품군, 파생=품목(grant.scope 기준).
- 분류를 **유지 / 탈락**로(신규는 신청 흐름이 담당하므로 연장에서 제외):
  - 유지 = 활성 grant + (자격 재충족 **또는** qualify='예외'(영업 bypass 유지 검토))
  - 탈락 = 활성 grant + 자격 미충족 + qualify='충족'이었던 건
- bypass(예외) 건은 표에 "영업예외(수동 검토)"로 구분 표기.

## 스토어

```ts
// State 추가
nego: NegoException[];                 // 기존, 확장된 타입
qualifyPolicies: QualifyPolicy[];      // 신규
submitNegoRequest(input: {
  accountIds: string[]; scope: ScopeSelector; scheduleId: string;   // 수정본이면 이미 복제된 id
  bypass: Record<string, string>;      // accountId → 사유 (미충족 계좌만)
  requestedBy: string;
}): { requestId: string; requested: number };
approveNegoRequest(requestId: string): { activated: number };
rejectNegoRequest(requestId: string, reason: string): void;
qualifyStatus(assetClass: AssetClass, accountId: string): { met: boolean; policy: QualifyPolicy | null };
```

- `submitNegoRequest`: 각 계좌마다 grant(status '요청', qualify 충족/예외, requestId 공유) 추가. 활성 아님 → 해석에 영향 없음.
- `approveNegoRequest`: 그 requestId의 grant들을 status '활성' + validFrom=TODAY + validTo=`extendOneYear(TODAY)` + approvedAt=TODAY로. 각 계좌 캐시 무효화.
- `rejectNegoRequest`: 해당 grant들 status '반려' + reason.
- 기존 `batchEvalNegotiations` 제거(또는 no-op 유지 판단) — 배치 ④ 자리는 "연장 재평가"로 문구 조정. 관련 테스트 갱신.

## 화면

- **이벤트 등록(Wizard)**: 유형 토글(EVENT/NEGOTIATED)·조건 입력(지표/임계/액션) 제거. 항상 EVENT.
- **협의 신청(신규 탭)**: ①적용범위(상품군·거래소·세션·채널, 파생 품목) ②요율표(표준 목록 선택 → 구성요소 수정 가능; 수정 시 복제) ③계좌번호 리스트(붙여넣기, 12자리 검증) → 계좌별 자격 자동판정 표(충족/미충족) + 미충족 계좌 bypass 체크·사유 → [협수 요청].
- **협의 승인(신규 탭, 별도)**: status '요청' grant를 requestId로 묶어 카드로. 각 카드에 적용범위·요율표·**계좌번호 목록(자격상태: 충족/영업예외·사유)** 나열 → [승인]/[반려].
- **협수 관리(기존 Negotiated)**: 활성 협의 현황 + 연장 리뷰(위 적응판). 신청/승인은 이 화면에서 분리.
- **App 탭**: `협의 신청`, `협의 승인` 추가. (`협수 관리` 유지)

## Mock 마이그레이션

- NEGOTIATED `FeeRule`(RULE-NEGO-STOCK-US, RULE-NEGO-DERIV-CME) 제거.
- `qualifyPolicies` 시드: 해외주식(6개월평균자산 5억), 해외파생(6개월약정액 1억) 등.
- 활성 grant 시드: 001 해외주식(충족·활성), 003 해외주식(미충족·과거 bypass 아님 → 연장 탈락 시연), 004 해외파생 6A(충족·활성).
- 요청 grant 시드 1건(승인 화면 시연): 예) 002 해외주식 미충족 → 영업 bypass 요청(status 요청).
- 요율표: FS-NEGO-STOCK-US, FS-NEGO-DERIV-CME 유지(협의 grant가 참조).
- **협의용 가입 이력 제거**: `RULE-NEGO-*`에 걸린 `mockEnrollments` 항목 삭제(협의는 이제 grant 기반, 가입 이력 불사용). 이벤트 가입 이력(SIGNUP2M 가입형)은 유지.
- **배치 ④ 처리**: `batchEvalNegotiations`와 배치 플로우 ④ 카드 제거. 협의 부여는 승인이, 재평가는 연장 리뷰가 담당. 배치 잡 목록·관련 테스트에서 ④ 삭제(번호 재정렬 또는 자리 유지 판단은 구현자).

## 테스트 계획

- `qualify.test.ts`: 충족/미충족/정책없음.
- `resolve.test.ts`: nego 후보는 status '활성'만(요청 grant 무시). NEGOTIATED 오버레이 제거 확인.
- `useStore.test.ts`: submitNegoRequest → 요청 grant N개 생성(해석 불변). approveNegoRequest → 활성화 + 해당 계좌 해석이 협의로. rejectNegoRequest → 반려.
- `negoExtension.test.ts`: grant+정책 기반 유지/탈락, bypass 영업예외 표기.
- 기존 e2e/배치 테스트에서 NEGOTIATED 룰 전제 부분 갱신.

## 범위 밖

- 자격 정책의 현업 설정 UI(시드 고정). 요청 부분승인(계좌별 일부만 승인) — 요청 단위 일괄 승인만.
- 협의 만료 시 시간 기반 자동 무효화(프로토타입 TODAY 고정).

## Self-Review 메모

- 별도 요청 엔티티 대신 grant 상태로 단순화 — 요청/활성/반려가 한 레코드 수명주기.
- 해석 정리: nego=활성 grant만, 오버레이=EVENT만 → NEGOTIATED 룰 개념 제거로 군더더기 해소.
- 최대 파급: mock에서 NEGOTIATED 룰 제거가 배치 ④·연장 리뷰·e2e에 연쇄 → 각 태스크에서 갱신.
