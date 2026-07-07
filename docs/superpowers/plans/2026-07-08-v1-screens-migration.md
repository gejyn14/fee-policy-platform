# v1 화면 전환 구현 계획 (레거시 6종+승인함 → 서버 API, 구간표 저작 관통)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드·이벤트 등록·승인함·협의 신청·협의 승인·협수 관리·수수료 결정 흐름을 실 백엔드 API 기반으로 전환하고, 국내 옵션 구간표(BANDS) 수수료 저작→검증→승인→배정→체결 계산을 실 모델로 관통시킨다.

**Architecture:** 서버 보강 4건(V3 시드·submit·nego 목록 2종·trace) 후 화면을 하나씩 API 기반으로 재작성. 화면은 `src/api/client.ts`만 사용(useStore 제거), 표시 한글·전송 영문.

**Tech Stack:** 기존과 동일 (Spring Boot 3/Java 17/Flyway/Testcontainers · React/Vite/vitest)

**스펙:** `docs/superpowers/specs/2026-07-08-v1-screens-migration-design.md`

## Global Constraints

- 서버 실행 전제: podman `fees-pg`(5433) — 기존 DB에 Flyway V3가 증분 적용됨
- 도메인 로직 재사용 — trace 엔드포인트에 신규 판정 로직 금지(PolicyRanking·ScopeMatcher·EligibilityGate 호출만)
- 전환 화면에서 `useStore`/`mock.ts` import 0건 (미전환 화면은 건드리지 않음)
- 금액·요율 표시는 서버 값 그대로(재계산 금지), 라벨 변환은 `src/api/labels.ts` 한 곳
- 각 태스크: 테스트 먼저 → 구현 → `./gradlew test`(서버) 또는 `npm run build && npm test`(웹) green → 커밋

---

## Phase A — 서버 보강

### Task A1: V3 시드 — 국내파생 K200 + 구간표 기준선

**Files:**
- Create: `server/src/main/resources/db/migration/V3__seed_domestic_deriv.sql`
- Test: `server/src/test/java/kr/fees/persistence/DomesticDerivSeedTest.java`

**Interfaces:**
- Produces: 품목 K200(KRX), 요율표 `SCH-DD-BASE`(BANDS 3구간+정액 300), 룰 `R-BASE-DD`, 8041 계좌 국내파생 개설

- [ ] **Step 1: V3 작성**

```sql
-- 국내파생(KOSPI200) — 구간표(BANDS) 기준선. 구 mock FS-BASE-DERIV-KR 구조 이관.
INSERT INTO product(asset_class, exchange_code, product_code, product_name, currency, sessions) VALUES
  ('DOMESTIC_DERIV', 'KRX', 'K200', 'KOSPI200', 'KRW', ARRAY['REGULAR']);

INSERT INTO fee_schedule(schedule_id, schedule_name) VALUES
  ('SCH-DD-BASE', '국내파생(KOSPI200옵션) 기본 — 구간표');

INSERT INTO fee_component(schedule_id, seq, name, kind, payer, rate_type, rate_bp, flat_amount, bands, min_fee) VALUES
  ('SCH-DD-BASE', 0, '자사 수수료', 'OWN', 'CUSTOMER', 'BANDS', NULL, NULL,
   '[{"from":0,"to":0.42,"rateBp":14,"flat":13},{"from":0.42,"to":2.47,"rateBp":15},{"from":2.47,"to":null,"rateBp":14.7,"flat":78}]'::jsonb,
   NULL),
  ('SCH-DD-BASE', 1, '거래소 수수료', 'AGENCY', 'CUSTOMER', 'FLAT', NULL, 300, NULL, NULL);

INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
    benefit_kind, schedule_id, scope_asset_class) VALUES
  ('R-BASE-DD', '국내파생 기본', 'BASE', 'ACTIVE', 'AUTO_ENROLL', '2026-01-01', '9999-12-31',
   'CALENDAR', 'SCH-DD-BASE', 'DOMESTIC_DERIV');

INSERT INTO account_product_group(account_id, asset_class) VALUES
  ('8041-2237-01', 'DOMESTIC_DERIV');
```

- [ ] **Step 2: 테스트** — ①bands 왕복(`ScheduleRepository.findById("SCH-DD-BASE")` 밴드 3개·경계값) ②`FeeCalculator` 구간 매칭(price 0.3→14bp+13, 1.0→15bp, 3.0→14.7bp+78, 각각 +거래소 300) ③lookup: 8041 K200 OPTIONS 조회 → 미스→기본 `R-BASE-DD` fallback
- [ ] **Step 3: `./gradlew test` green → Commit** — `feat(persistence): V3 시드 — 국내파생 K200 구간표 기준선`

### Task A2: 룰 submit 전이

**Files:**
- Modify: `server/src/main/java/kr/fees/service/RuleService.java`, `server/src/main/java/kr/fees/api/RuleController.java`
- Test: `server/src/test/java/kr/fees/api/WorkflowApiTest.java` (케이스 추가)

**Interfaces:**
- Produces: `POST /api/rules/{id}/submit`(DRAFT→PENDING). `approve`는 PENDING 아닐 때 400.

```java
// RuleService 추가
@Transactional
public void submit(String ruleId) {
    RuleModel r = rules.findById(ruleId).orElseThrow(() -> new IllegalArgumentException("룰 없음: " + ruleId));
    if (r.status() != RuleStatus.DRAFT) throw new IllegalArgumentException("DRAFT만 상신 가능: " + r.status());
    rules.updateStatus(ruleId, RuleStatus.PENDING);
}
// approve 첫머리에 상태 가드 추가
if (rules.findById(ruleId).orElseThrow().status() != RuleStatus.PENDING)
    throw new IllegalArgumentException("PENDING만 승인 가능");
```

- [ ] 테스트: 기안→submit→PENDING, DRAFT 직접 approve 400, submit 후 approve 성공. **주의: 기존 `룰_승인_흐름` 테스트가 PENDING 시드(R-EVT-DS)를 바로 approve 하므로 그대로 통과해야 함.**
- [ ] Commit — `feat(api): 룰 상신(submit) 전이 + 승인 상태 가드`

### Task A3: 협의 조회 API 2종

**Files:**
- Modify: `server/src/main/java/kr/fees/service/NegoService.java`, `api/NegoController.java`, `persistence/EnrollmentRepository.java`
- Test: `server/src/test/java/kr/fees/api/NegoListApiTest.java`

**Interfaces:**
- `GET /api/nego/requests?status=REQUESTED` → `[{requestId, ruleId, ruleName, requestedBy, requestedAt, items:[{enrollmentId, accountId, accountName, qualifyType, reason}]}]`
- `GET /api/nego/enrollments` → `[{enrollmentId, accountId, accountName, ruleId, ruleName, scheduleId, validFrom, validTo, qualifyType}]` (NEGOTIATED·ACTIVE만)
- EnrollmentRepository에 `findByStatus(EnrollmentStatus)` 추가(요청자·일시 포함 확장 record `EnrollmentDetail` 반환 — 기존 `Enrollment` record는 변경하지 않는다)

- [ ] 테스트: 신청 생성 후 REQUESTED 목록에 묶여 나옴 / 시드 T2 부여가 enrollments 목록에 나옴
- [ ] Commit — `feat(api): 협의 요청 목록·활성 부여 목록`

### Task A4: 결정 추적 trace

**Files:**
- Create: `server/src/main/java/kr/fees/service/TraceService.java`, `server/src/main/java/kr/fees/api/TraceController.java`
- Test: `server/src/test/java/kr/fees/api/TraceApiTest.java`

**Interfaces:**
- `GET /api/trace?accountId&assetClass&lookupKey&exchange&session&product&channel&tradeDate` → 스펙 §2.4 JSON
- gateNote 규칙: scopeMatch=false→"범위 불일치" / NEGOTIATED gate 실패→"enrollment 없음/기간 밖" / EVENT isTarget 실패→"대상 아님" / isBenefitActive 실패→"기간 밖" / 통과→null

```java
// TraceService 핵심 — 도메인 재사용, 첫 (scopeMatch && gatePass)가 winner
List<RankedPolicy> ranking = PolicyRanking.build(activeRulesOfAssetClass, schedMap, d);
for (RankedPolicy p : ranking) {
    boolean scope = ScopeMatcher.matches(p.rule().scope(), key);
    boolean gate = scope && EligibilityGate.passes(p.rule(), acct, enr, d);
    ...
}
// applied = LedgerLookupService.lookup(...) 결과 그대로(배정판 히트/미스→기본)
```

- [ ] 테스트: 8041 ES FUTURES → T3 "enrollment 없음"·T2 winner·BASE 후순위, bindingHit=true / K200 OPTIONS → BASE winner·bindingHit=false·fallbackToBase=true
- [ ] Commit — `feat(api): 수수료 결정 추적(trace) — 후보·게이트·배정판 히트`

---

## Phase B — 화면 전환 (화면당 1커밋, `npm run build && npm test` green 필수)

### Task B1: client.ts·labels.ts 확장

**Files:** Modify: `src/api/client.ts`, `src/api/labels.ts`

- client.ts 타입 추가: `RuleDto`(scope 포함)·`ScheduleDto`(components·bands)·`TraceResponse`·`NegoRequestGroup`·`NegoEnrollment`·`ExtGroup`·`ValidationReport`. **bands의 from/to/rateBp/flat는 서버 jsonb 키와 동일한 camelCase.**
- labels.ts 추가: ruleStatus(DRAFT 기안/PENDING 승인대기/ACTIVE 활성/REJECTED 반려/EXPIRED 종료), applyMode(APPLICATION 신청형/AUTO_ENROLL 가입형/DORMANT_RETURN 휴면복귀형/TARGETED 타겟추출형), kind(OWN 자사/AGENCY 유관기관/TAX 세금), payer(CUSTOMER 고객부과/COMPANY 회사부담/EXEMPT 면제), rateType(RATE 정률/FLAT 정액/BANDS 구간표), **역방향 함수**(한글→영문, Wizard 폼 전송용)
- [ ] `npm run build` green → Commit

### Task B2: 대시보드

**Files:** Rewrite: `src/screens/Dashboard.tsx`

- 집계 카드 4종(/api/dashboard) + 룰 테이블(/api/rules — 이름 검색, 상태·타입 필터, 클릭 시 상세 패널: scope·기간·요율표) + 최근 배정 변경 10건(라벨 변환)
- 수용 기준: useStore 미사용, 서버 중단 시 에러 배너

### Task B3: 이벤트 등록(Wizard) — 구간표 관통 ★핵심

**Files:** Rewrite: `src/screens/Wizard.tsx` (기존 4단계 구조·밴드 에디터 UI는 보존하되 데이터원·전송을 교체)

- 1단계 기본정보: 이름·타입(EVENT/NEGOTIATED)·applyMode·기간·benefit(CALENDAR/RELATIVE+개월)
- 2단계 적용범위: 자산군 → 조회구분(멀티) → 거래소·세션·채널(멀티, 빈=전체) → 파생이면 품목 선택(/api/products), 주식형이면 품목 UI 숨김(불변식)
- 3단계 요율표: 구성요소 행 편집(name·kind·payer·rateType) — **rateType=구간표면 밴드 행 편집(from/to[빈=무한]/rateBp/flat) + minFee**. 미리보기: 대표 가격 3개(0.3/1.0/3.0)에 대해 클라이언트 표시용 계산
- 4단계 검증·상신: `POST /api/rules`(rule+schedule DTO — 영문 코드값 변환) → `POST validate` 리포트 표시(지배관계 실패 시 가격·후보요율·기준요율, 역마진 경고) → 통과 시 `POST submit`
- 수용 기준(스펙 §4-2): K200 OPTIONS 구간표 이벤트(전 구간 기준선보다 저렴, 예: 12bp+10 / 13bp / 13bp+60) 작성→검증 통과→상신. 역케이스(한 구간 비싸게) 검증 리포트에 실패 지점 표시

### Task B4: 승인함

**Files:** Rewrite: `src/screens/Approvals.tsx`

- PENDING 룰 목록(→ B3에서 상신한 룰 + 시드 R-EVT-DS) → 승인(성공 시 증분 결과 표시, 400이면 problem+json의 지배관계 상세 표시)·반려

### Task B5: 협의 신청

**Files:** Rewrite: `src/screens/NegoRequest.tsx`

- NEGOTIATED 룰 셀렉트(/api/rules 필터) + 계좌 다건 선택(지표 표시) → `POST /api/nego/requests`. 응답의 계좌별 MET/EXCEPTION 표시. 400(사유 누락) 시 해당 계좌에 사유 입력칸 노출 후 재시도. 요율 개별조정 없음(표준등급 안내 문구)

### Task B6: 협의 승인

**Files:** Rewrite: `src/screens/NegoApproval.tsx`

- `GET /api/nego/requests?status=REQUESTED` 요청번호 카드(계좌들·자격구분·사유) → 일괄 승인(`approve?baseDate=오늘` — 증분 결과 표시)·반려

### Task B7: 협수 관리

**Files:** Rewrite: `src/screens/Negotiated.tsx`

- 활성 부여 테이블(/api/nego/enrollments) + 연장 대상(/api/nego/extension-candidates: 그룹·유지/탈락·사유) → 유지 대상 선택 `POST /api/nego/extend {enrollmentIds, months:12}` → 갱신된 validTo 확인

### Task B8: 수수료 결정 흐름

**Files:** Rewrite: `src/screens/FeeTrace.tsx`

- 입력: 계좌·자산군·조회구분·거래소·품목(파생만)·채널·(세션) — 5단계 렌더:
  ① 조회키 구성(입력 요약) ② 후보·게이트(/api/trace candidates: 랭킹순, 탈락 사유 뱃지) ③ 승자 ④ 배정판 히트/미스(**미스 = "우대 없음 → 기본수수료 직접 적용" 정상 경로로 시각화**, §1.4) ⑤ 체결 입력(가격·수량)→`POST /api/calc` 구성요소 명세 — **구간표 구성요소는 매칭 구간 하이라이트**(schedule DTO의 bands와 입력 가격으로 클라이언트에서 판별)
- 수용 기준: 8041 ES 선물(협의 히트)과 K200 옵션(미스→기본, 구간 하이라이트) 두 시나리오

### Task B9: 마무리

- [ ] 전환 화면 7종에서 `useStore|mock` import 0건 확인: `grep -l "useStore" src/screens/{Dashboard,Wizard,Approvals,NegoRequest,NegoApproval,Negotiated,FeeTrace}.tsx` → 출력 없음
- [ ] 깨진 프론트 테스트 정리(전환 화면의 구 로직 테스트는 서버 책임으로 이관됐으므로 삭제/교체), `npm run build && npm test` + `./gradlew test` green
- [ ] README 화면 표 갱신, App.tsx 기본 탭을 '대시보드'로 복귀(Live 탭은 유지)
- [ ] Commit — `feat(web): 레거시 화면 서버 전환 완료`

## Self-Review

- 스펙 커버리지: §2.1→A1, §2.2→A2, §2.3→A3, §2.4→A4, §3 표 7행→B2~B8, §4 완료기준→B3(2·3)·B8(1)·B9(4). 누락 없음.
- 타입 일관성: trace 응답 필드(candidates/gateNote/applied)가 A4 정의=B8 사용 동일. submit→PENDING이 B4 목록 조건과 일치. EnrollmentDetail은 A3 정의=B6·B7 사용.
- 리스크 명시: 기존 WorkflowApiTest의 approve 직접 호출은 시드가 PENDING이므로 A2 가드에 걸리지 않음(확인 케이스 포함).
