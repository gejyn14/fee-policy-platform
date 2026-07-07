# v1 실 플랫폼 전환 설계 — Spring Boot + PostgreSQL (기술설계서 v1.5 구현)

> 2026-07-07 · 상태: 승인됨(사용자 확정) · 상위 문서: `docs/수수료정책플랫폼_기술설계서_v1.5.docx`
> 결정 사항: Spring Boot 3 + Java 21 · React 프론트 유지+API 연결 · 전체 범위(승인·협의 워크플로우 포함) · Docker Compose Postgres 16

## 1. 목표

프로토타입(React+zustand, 인메모리 mock)을 기술설계서 v1.5 모델대로 실 구조로 전환한다:

1. **백엔드 신설**: Spring Boot 3(Java 21, Gradle) — 도메인 로직·배치·REST API
2. **PostgreSQL 실 스키마**: 배정판(fee_binding)·이력·부여관계 등 v1.5 데이터 모델 (Flyway 마이그레이션)
3. **모델 전환**: v0.8 협의 오버레이 모델 → v1.5 모델
   - 협의(NEGOTIATED)를 표준 룰로 일원화 — `NegoException` 개념 폐기, 협의 게이트 = enrollment 유효성
   - 통합 랭킹 단일 경로(`winnerFor`) — 동률 시 NEGOTIATED > EVENT > BASE > 범위 구체성 > 룰ID
   - 조회키에 **조회구분(lookup_key)** 신설, **세션 유지**(v1.3 승격 결정), 파생만 품목
   - 배정판 3층 산출: 수시 증분 + 일 delta + 전체 재산출(정합성 진본)
4. **프론트 연결**: 기존 React 화면 유지, zustand mock → API 클라이언트 교체

비범위(추후 판): 인증/권한, 실 원장 연계, 운영 배포 인프라, 계좌·종목 마스터 동기화 배치.

## 2. 저장소 구조

```
fees/
├── src/                  기존 React 프론트 (유지)
├── server/               Spring Boot 3 (Gradle, Java 21)
│   ├── build.gradle
│   └── src/main/java/kr/fees/
│       ├── domain/       순수 자바 — 계산·랭킹·게이트·승자확정 (Spring 비의존)
│       ├── persistence/  JdbcTemplate 저장소 + Flyway (resources/db/migration)
│       ├── batch/        배정판 산출기 (전체·delta·증분)
│       └── api/          REST 컨트롤러 + DTO
│   └── src/test/java/    JUnit5 + Testcontainers(Postgres)
├── docker-compose.yml    postgres:16
└── vite.config.ts        dev proxy: /api → localhost:8080
```

원칙: domain 패키지는 Spring·DB에 의존하지 않는 순수 함수/불변 객체. 배치와 API가 같은 `WinnerResolver`를 공유한다(로직 한 벌 — v1.5 §10).

## 3. 코드값 표기

DB·API 코드값은 전부 영문(v1.2 표기 원칙). 프론트가 한글 라벨로 변환한다.

| 개념 | 영문 코드값 |
|---|---|
| 자산군 | DOMESTIC_STOCK / OVERSEAS_STOCK / DOMESTIC_DERIV / OVERSEAS_DERIV / GOLD_SPOT |
| 조회구분 | FUTURES / OPTIONS / STOCK / ETF / GOLD |
| 세션 | PRE / REGULAR / AFTER (배정판에서는 '*' 허용) |
| 채널 | HTS / MTS / API / ARS / BRANCH / LIQUIDATION |
| 룰 타입 | BASE / EVENT / NEGOTIATED |
| 룰 상태 | DRAFT / PENDING / ACTIVE / REJECTED / EXPIRED |
| 대상 편입 | APPLICATION(신청형) / AUTO_ENROLL(가입형) / DORMANT_RETURN(휴면복귀형) / TARGETED(타겟추출형) |
| 부담주체 | CUSTOMER / COMPANY / EXEMPT |
| 요율 방식 | RATE(정률) / FLAT(정액) / BANDS(구간표) |
| 혜택 기간 | CALENDAR(캘린더) / RELATIVE(상대: 가입일+N개월) |
| 부여 상태 | REQUESTED / ACTIVE / REJECTED / EXPIRED |
| 자격 구분 | MET(충족) / EXCEPTION(영업예외) |

## 4. PostgreSQL 스키마 (Flyway V1)

핵심만 발췌 — 전체 DDL은 구현 계획의 마이그레이션 태스크에 있다.

- `account`(계좌: 등급·휴면복귀·6개월 지표), `product`(품목 마스터: 자산군·거래소·품목·세션 배열), `qualify_policy`(협의 자격 기준)
- `fee_schedule` / `fee_component`(구성요소: kind·payer·rate_type·rate_bp·flat_amount·bands **jsonb**·min_fee)
- `fee_rule`: 룰 공통(타입·상태·기간·benefit_kind/months·condition) + 적용범위를 **명시 칼럼**으로 — `scope_asset_class text NOT NULL`, `scope_exchanges/sessions/lookup_keys/products/channels text[]`(NULL=전체), `scope_exclude_products text[]`, `target_account_ids text[]`
- `fee_enrollment`(부여관계): account×rule, status·valid_from/to·qualify_type·reason·request_id·승인 메타 — 협의와 신청형 이벤트가 공용
- **`fee_binding`(배정판)** — v1.2 §5.1에 **세션 축 추가**(v1.3 승격 결정 반영):

```sql
CREATE TABLE fee_binding (
    account_id     text NOT NULL,
    asset_class    text NOT NULL,
    exchange_code  text NOT NULL DEFAULT '*',
    lookup_key     text NOT NULL,
    session_code   text NOT NULL DEFAULT '*',
    product_code   text NOT NULL DEFAULT '*',
    channel_code   text NOT NULL DEFAULT '*',
    valid_from     date NOT NULL,
    valid_to       date NOT NULL,
    schedule_id    text NOT NULL REFERENCES fee_schedule(schedule_id),
    source_rule_id text NOT NULL REFERENCES fee_rule(rule_id),
    source_type    text NOT NULL CHECK (source_type IN ('BASE','EVENT','NEGOTIATED')),
    reason         text,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, asset_class, exchange_code, lookup_key,
                 session_code, product_code, channel_code, valid_from)
);
-- 원장 조회용 커버링 인덱스 (index-only)
CREATE UNIQUE INDEX ix_fee_binding_lookup ON fee_binding
    (account_id, asset_class, lookup_key, exchange_code, session_code,
     product_code, channel_code, valid_from)
    INCLUDE (valid_to, schedule_id, source_rule_id, source_type);
```

- `fee_binding_history`: 키 칼럼 동일 + old/new(schedule·rule·type) + trigger_source(DAILY_REBUILD / DELTA / RULE_APPROVED / NEGO_APPROVED / NEGO_EXTENDED / ENROLLMENT / DORMANT_RETURN / RULE_EXPIRED) + changed_at
- `condition_eval_log`(협의 조건 평가 근거), `batch_run`(배치 실행·diff 리포트 요약)

원장 체결 조회 계약(§5.3 + 세션):

```sql
SELECT schedule_id, source_rule_id, source_type
FROM fee_binding
WHERE account_id = :acct AND asset_class = :asset AND lookup_key = :lookup
  AND exchange_code IN (:exch,'*') AND session_code IN (:sess,'*')
  AND product_code IN (:prod,'*') AND channel_code IN (:chan,'*')
  AND valid_from <= :d AND :d <= valid_to
ORDER BY (product_code = :prod) DESC, (channel_code = :chan) DESC,
         (session_code = :sess) DESC, (exchange_code = :exch) DESC
LIMIT 1;
```

0건이면 등급 요율 fallback(프로토타입에선 BASE 룰 직접 해석으로 대체).

## 5. 도메인 (Java, 순수)

| 단위 | 책임 | TS 원본(스펙 소스) |
|---|---|---|
| `FeeKey` | 조회키 record: assetClass·exchange·lookupKey·session·channel·product(파생만) | `src/domain/feeKey.ts` |
| `FeeCalculator` | 요율표 평가 — 정률/정액/구간표(한 구간 정률+정액 동시), 최소수수료, 부담주체 합산 | `calc.ts` |
| `RankKey` | 구조 그룹 순위값(정률=요율 합, 정액=정액 합, 구간표=대표 구간+최소) | `policyRank.ts rankKey` |
| `PolicyRanking` | BASE+EVENT+**NEGOTIATED** 통합 랭킹, 정렬: rank ↑ → 타입(NEGO>EVT>BASE) → 범위 구체성 ↓ → ruleId | `policyRank.ts` (NEGOTIATED 편입이 변경점) |
| `EligibilityGate` | BASE=통과 / EVENT=isTarget(대상)+isBenefitActive(기간, 상대형은 가입일+N) / NEGOTIATED=**enrollment ACTIVE & valid_from≤d≤valid_to** | `binding.ts isTarget/isBenefitActive` + v1.5 §5.2 |
| `WinnerResolver` | 셀별 승자 = 랭킹 내려가며 게이트 통과 첫 정책. **협의 우선 분기 없음** | `resolve.ts` 대체 |
| `DominanceValidator` | 우대 요율표가 기준선을 전 가격에서 하회하는지(등록 검증) | `dominance.ts` |
| `ScopeMatcher` | 룰 scope × FeeKey/셀 매칭('*'=NULL=전체, 파생만 품목·exclude) | `resolve.ts scopeMatchesKey` |

금액은 `BigDecimal`. 기존 TS 테스트(calc 33·policyRank 12·dominance 8 등 143개)가 기대값 스펙 — JUnit으로 포팅하되, v1.5 모델 변경분(협의 일원화·lookupKey·세션 게이트)은 신규 케이스로 추가.

## 6. 배정판 배치 (batch 패키지)

세 산출 경로가 `WinnerResolver.winnerFor(cell, account, context)` 한 함수를 공유한다.

1. **전체 재산출** `POST /api/batch/rebuild`(+스케줄러): 셀 유니버스 전개(계좌×자산군·거래소·조회구분·세션[룰이 세션 한정일 때만 분화]·품목[파생만]; 계좌가 개설한 상품군만) → **키 정렬 순서로 스테이징 적재**(JDBC batch, 정렬 필수 — v1.5 §10.3 실측 근거) → 현행과 diff → upsert + history(DAILY_REBUILD) → diff 리포트를 `batch_run`에 기록
2. **일 delta** `POST /api/batch/delta`: `valid_to = :yesterday` 행의 셀 + 오늘 시작(`start_date = :today`) 룰 scope 셀만 재산출(트리거 DELTA)
3. **수시 증분**: 룰 승인/조기종료, 협의 승인/연장, 이벤트 신청, 휴면복귀 처리 시 해당 계좌×scope 셀만 — 서비스 레이어에서 동기 호출(트리거 = 각 이벤트명)

채널·세션 축은 "매체/세션 한정 룰이 승자가 되는 셀"에만 구체 행을 추가하고 그 외 '*' 행 하나로 둔다(행 수 절약, v1.5 §10.1 ②).

## 7. REST API

| 그룹 | 엔드포인트 |
|---|---|
| 룰 | `GET/POST /api/rules`, `GET /api/rules/{id}`, `POST /api/rules/{id}/validate`(지배관계·역마진 리포트), `/approve`, `/reject`, `/expire` |
| 협의 | `POST /api/nego/requests`(계좌들×협의룰 신청 — 자격 자동판정·request_id 묶음, 요율 조정 시 파생 요율표 생성), `GET /api/nego/requests?status=`, `POST /api/nego/requests/{requestId}/approve·reject`, `GET /api/nego/extension-candidates`(그룹 축: 주식형=상품군, 파생=품목), `POST /api/nego/extend`(일괄 연장 — valid_to 갱신 + eval log) |
| 이벤트 가입 | `POST /api/enrollments`(신청형 이벤트 가입) |
| 배정판 | `GET /api/accounts/{id}/bindings`, `GET /api/accounts/{id}/bindings/history`, `GET /api/lookup`(원장 체결 조회 시뮬 — §4 계약 SQL), `POST /api/calc`(체결 입력 → 요율표 평가 명세) |
| 배치 | `POST /api/batch/rebuild`, `POST /api/batch/delta`, `GET /api/batch/runs` |
| 조회 | `GET /api/dashboard`(대시보드 집계), `GET /api/products`, `GET /api/accounts`, `GET /api/schedules` |

에러: RFC 7807(problem+json). 검증 실패(지배관계 위반 등)는 400 + 상세 리포트 바디.

## 8. 프론트 전환

- `src/api/client.ts` 신설(fetch 래퍼) + `vite.config.ts`에 `/api` 프록시
- `useStore.ts`: mock 초기화 → API 로딩으로 교체. 액션(룰 승인·협의 승인 등)은 API 호출 후 재조회
- 한글 라벨 ↔ 영문 코드값 매핑은 `src/screens/labels.ts`로 일원화(기존 파일 확장)
- 기존 프론트 도메인 코드(`src/domain/*`)는 화면 미리보기·시뮬레이션 용도로 당분간 공존 — 서버가 진실의 원천, 화면 내 재계산은 단계적으로 제거

## 9. 테스트 전략

- **도메인 단위(JUnit5)**: TS 테스트 케이스 포팅 + v1.5 신규(협의 게이트, 동률 tie-break, lookupKey/세션 매칭). DB 불필요.
- **통합(Testcontainers postgres:16)**: Flyway 마이그레이션 적용 → 시드 → 전체 재산출 → §6.2 예시 재현(계좌 8041-2237-01: ES/GC 선물=협의 T2, ES 옵션=BASE, 해외 ETF=EVENT, 주식=BASE) → delta·증분·이력 검증 → lookup 계약 SQL 검증.
- **시드**: `mock.ts` 데이터를 영문 코드값으로 번역한 Flyway `V2__seed.sql`(dev 프로파일 한정).
- 프론트 기존 vitest는 화면 로직 위주로 축소 유지.

## 10. 검증 시나리오 (완료 기준)

1. `docker compose up -d` → `./gradlew bootRun` → `npm run dev` 로 전체 기동
2. 전체 재산출 실행 → 8041-2237-01 배정판이 기술설계서 v1.5 §6.2 표와 일치
3. 협의 신청→승인 → 해당 계좌 배정판 증분 갱신 + history(NEGO_APPROVED) 적재
4. 이벤트 조기종료 승인 → 증분 갱신, 다음 delta 배치에서 만료 행 정리
5. `GET /api/lookup`이 체결 정보만으로 요율표를 확정(§5.3), `POST /api/calc`가 구성요소 명세 반환
6. 서버 전체 테스트 green + 프론트 빌드·기존 화면 동작
