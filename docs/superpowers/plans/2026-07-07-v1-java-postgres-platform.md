# v1 실 플랫폼 전환 구현 계획 (Spring Boot 3 + PostgreSQL)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기술설계서 v1.5 모델(협의 일원화·수수료 배정판·조회구분·세션 조회키)을 Spring Boot 3 + PostgreSQL로 구현하고 기존 React 프론트를 API로 연결한다.

**Architecture:** `server/`에 Gradle 단일 모듈 Spring Boot 앱. `domain`(순수 자바) ← `batch`/`api`가 공유, `persistence`(JdbcTemplate+Flyway). 배정판(fee_binding)이 원장 조회의 유일한 접점. 프론트는 zustand mock을 API 클라이언트로 교체.

**Tech Stack:** Java 21, Spring Boot 3.3+, spring-jdbc(JdbcTemplate), Flyway, PostgreSQL 16(Docker Compose), JUnit5, Testcontainers, 기존 React+Vite+zustand.

**스펙:** `docs/superpowers/specs/2026-07-07-v1-java-postgres-platform-design.md` (승인됨)
**모델 스펙 원천:** `docs/수수료정책플랫폼_기술설계서_v1.5.docx`, 기존 TS 도메인 `src/domain/*`(테스트 143개 = 기대값 스펙)

## Global Constraints

- Java 21 / Spring Boot 3.3+ / PostgreSQL 16 / Gradle(Kotlin DSL 아님, groovy build.gradle)
- DB·API 코드값 전부 영문(스펙 §3 매핑표). 프론트만 한글 라벨(`src/screens/labels.ts`)
- 금액은 `BigDecimal`, 반올림 `HALF_UP` 소수 2자리(TS `Math.round(x*100)/100` 동치)
- domain 패키지는 Spring·DB import 금지(순수 자바)
- 배치·API·증분이 **동일한 `WinnerResolver`를 공유** — 승자 확정 로직 복제 금지
- 파생(DOMESTIC_DERIV/OVERSEAS_DERIV)만 품목 차원. 주식형 셀의 product는 '*' (v0.5 불변식)
- 배정판 전체 재산출은 **키 정렬 순서로 적재**(무작위 upsert 금지 — v1.5 §10.3)
- 각 태스크: 테스트 먼저(RED) → 최소 구현(GREEN) → 커밋. 커밋 메시지 한글, 기존 컨벤션(`feat:`/`docs:`/`chore:`)

---

## Phase 0 — 인프라 골격

### Task 1: Docker Compose + Spring Boot 스켈레톤

**Files:**
- Create: `docker-compose.yml`
- Create: `server/build.gradle`, `server/settings.gradle`, `server/gradle.properties`
- Create: `server/src/main/java/kr/fees/FeesApplication.java`
- Create: `server/src/main/resources/application.yml`
- Test: `server/src/test/java/kr/fees/FeesApplicationTest.java`

**Interfaces:**
- Produces: 실행 가능한 Spring Boot 앱(:8080), postgres:16(:5432, db=fees, user=fees, pw=fees)

- [ ] **Step 1: Docker Compose 작성**

```yaml
# docker-compose.yml (레포 루트)
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: fees
      POSTGRES_USER: fees
      POSTGRES_PASSWORD: fees
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
volumes:
  pgdata:
```

- [ ] **Step 2: Gradle 프로젝트 생성**

```groovy
// server/build.gradle
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.3.5'
    id 'io.spring.dependency-management' version '1.1.6'
}
group = 'kr.fees'
java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }
repositories { mavenCentral() }
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-jdbc'
    implementation 'org.springframework.boot:spring-boot-starter-validation'
    implementation 'org.flywaydb:flyway-core'
    implementation 'org.flywaydb:flyway-database-postgresql'
    runtimeOnly 'org.postgresql:postgresql'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
    testImplementation 'org.testcontainers:postgresql'
    testImplementation 'org.testcontainers:junit-jupiter'
}
tasks.named('test') { useJUnitPlatform() }
```

`server/settings.gradle`: `rootProject.name = 'fees-server'`

- [ ] **Step 3: 앱 클래스 + 설정**

```java
// server/src/main/java/kr/fees/FeesApplication.java
package kr.fees;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class FeesApplication {
    public static void main(String[] args) { SpringApplication.run(FeesApplication.class, args); }
}
```

```yaml
# server/src/main/resources/application.yml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/fees
    username: fees
    password: fees
  flyway:
    enabled: true
```

- [ ] **Step 4: 스모크 테스트 작성·실행**

```java
// server/src/test/java/kr/fees/FeesApplicationTest.java
package kr.fees;

import org.junit.jupiter.api.Test;

class FeesApplicationTest {
    @Test void appClassLoads() { new FeesApplication(); }
}
```

Run: `cd server && ./gradlew test` (gradle wrapper는 `gradle wrapper --gradle-version 8.10`으로 생성)
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit** — `chore: server 골격 — Spring Boot 3 + Docker Compose(postgres 16)`

### Task 2: Flyway V1 스키마 + Testcontainers 마이그레이션 검증

**Files:**
- Create: `server/src/main/resources/db/migration/V1__schema.sql`
- Create: `server/src/test/java/kr/fees/persistence/PgIntegrationTest.java` (베이스클래스)
- Test: `server/src/test/java/kr/fees/persistence/MigrationTest.java`

**Interfaces:**
- Produces: 전체 스키마. 이후 태스크의 테이블 계약. `PgIntegrationTest`(@Testcontainers 공유 베이스)

- [ ] **Step 1: V1__schema.sql 작성** — 스펙 §4 그대로. 전체 DDL:

```sql
CREATE TABLE account (
    account_id       text PRIMARY KEY,
    account_name     text NOT NULL,
    grade            text NOT NULL,
    dormant_returned boolean NOT NULL DEFAULT false,
    metric_6m_asset  numeric(18) NOT NULL DEFAULT 0,
    metric_6m_volume numeric(18) NOT NULL DEFAULT 0
);

CREATE TABLE account_product_group (      -- 셀 유니버스 pruning: 계좌가 개설한 상품군
    account_id  text NOT NULL REFERENCES account(account_id),
    asset_class text NOT NULL,
    PRIMARY KEY (account_id, asset_class)
);

CREATE TABLE product (
    asset_class  text NOT NULL,
    exchange_code text NOT NULL,
    product_code text NOT NULL,
    product_name text NOT NULL,
    currency     text NOT NULL,
    sessions     text[] NOT NULL,
    PRIMARY KEY (asset_class, exchange_code, product_code)
);

CREATE TABLE qualify_policy (
    asset_class text PRIMARY KEY,
    metric      text NOT NULL CHECK (metric IN ('AVG_ASSET_6M','VOLUME_6M')),
    threshold   numeric(18) NOT NULL
);

CREATE TABLE fee_schedule (
    schedule_id   text PRIMARY KEY,
    schedule_name text NOT NULL
);

CREATE TABLE fee_component (
    schedule_id text NOT NULL REFERENCES fee_schedule(schedule_id),
    seq         int  NOT NULL,
    name        text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('OWN','AGENCY','TAX')),
    payer       text NOT NULL CHECK (payer IN ('CUSTOMER','COMPANY','EXEMPT')),
    rate_type   text NOT NULL CHECK (rate_type IN ('RATE','FLAT','BANDS')),
    rate_bp     numeric(10,4),
    flat_amount numeric(18,4),
    bands       jsonb,          -- [{"from":0,"to":1000,"rateBp":14,"flat":13}, ...] to=null 허용
    min_fee     numeric(18,4),
    PRIMARY KEY (schedule_id, seq)
);

CREATE TABLE fee_rule (
    rule_id            text PRIMARY KEY,
    rule_name          text NOT NULL,
    rule_type          text NOT NULL CHECK (rule_type IN ('BASE','EVENT','NEGOTIATED')),
    rule_status        text NOT NULL CHECK (rule_status IN ('DRAFT','PENDING','ACTIVE','REJECTED','EXPIRED')),
    apply_mode         text NOT NULL CHECK (apply_mode IN ('APPLICATION','AUTO_ENROLL','DORMANT_RETURN','TARGETED')),
    start_date         date NOT NULL,
    end_date           date NOT NULL,
    benefit_kind       text NOT NULL DEFAULT 'CALENDAR' CHECK (benefit_kind IN ('CALENDAR','RELATIVE')),
    benefit_months     int,
    schedule_id        text NOT NULL REFERENCES fee_schedule(schedule_id),
    scope_asset_class  text NOT NULL,
    scope_exchanges    text[],            -- NULL = 전체
    scope_sessions     text[],
    scope_lookup_keys  text[],
    scope_products     text[],
    scope_exclude_products text[] NOT NULL DEFAULT '{}',
    scope_channels     text[],
    condition_metric   text CHECK (condition_metric IN ('AVG_ASSET_6M','VOLUME_6M')),
    condition_threshold numeric(18),
    condition_action   text CHECK (condition_action IN ('AUTO_EXTEND','APPROVE_EXTEND')),
    target_account_ids text[],
    created_by         text NOT NULL DEFAULT 'system',
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fee_enrollment (
    enrollment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id    text NOT NULL REFERENCES account(account_id),
    rule_id       text NOT NULL REFERENCES fee_rule(rule_id),
    status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('REQUESTED','ACTIVE','REJECTED','EXPIRED')),
    valid_from    date,
    valid_to      date,
    qualify_type  text CHECK (qualify_type IN ('MET','EXCEPTION')),
    reason        text,
    channel       text,
    request_id    text,
    enrolled_at   date,
    requested_by  text, requested_at timestamptz,
    approved_by   text, approved_at  timestamptz
);
CREATE INDEX ix_enrollment_account ON fee_enrollment (account_id, rule_id, status);
CREATE INDEX ix_enrollment_request ON fee_enrollment (request_id);

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
CREATE UNIQUE INDEX ix_fee_binding_lookup ON fee_binding
    (account_id, asset_class, lookup_key, exchange_code, session_code,
     product_code, channel_code, valid_from)
    INCLUDE (valid_to, schedule_id, source_rule_id, source_type);

CREATE TABLE fee_binding_history (
    history_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id     text NOT NULL,
    asset_class    text NOT NULL,
    exchange_code  text NOT NULL,
    lookup_key     text NOT NULL,
    session_code   text NOT NULL,
    product_code   text NOT NULL,
    channel_code   text NOT NULL,
    old_schedule_id text, old_source_rule_id text, old_source_type text,
    new_schedule_id text, new_source_rule_id text, new_source_type text,
    trigger_source text NOT NULL CHECK (trigger_source IN
        ('DAILY_REBUILD','DELTA','RULE_APPROVED','RULE_EXPIRED','NEGO_APPROVED',
         'NEGO_EXTENDED','ENROLLMENT','DORMANT_RETURN')),
    change_reason  text,
    changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_binding_hist ON fee_binding_history (account_id, asset_class, lookup_key, changed_at);

CREATE TABLE condition_eval_log (
    eval_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id bigint NOT NULL REFERENCES fee_enrollment(enrollment_id),
    metric      text NOT NULL,
    metric_value numeric(18) NOT NULL,
    threshold   numeric(18) NOT NULL,
    met         boolean NOT NULL,
    evaluated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batch_run (
    run_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_type    text NOT NULL CHECK (run_type IN ('FULL_REBUILD','DELTA')),
    base_date   date NOT NULL,
    inserted    int NOT NULL, updated int NOT NULL, deleted int NOT NULL, unchanged int NOT NULL,
    started_at  timestamptz NOT NULL, finished_at timestamptz NOT NULL
);
```

- [ ] **Step 2: Testcontainers 베이스 + 마이그레이션 테스트 작성·실행(RED→GREEN)**

```java
// server/src/test/java/kr/fees/persistence/PgIntegrationTest.java
package kr.fees.persistence;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@Testcontainers
public abstract class PgIntegrationTest {
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16");
    static { PG.start(); }
    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", PG::getJdbcUrl);
        r.add("spring.datasource.username", PG::getUsername);
        r.add("spring.datasource.password", PG::getPassword);
    }
}
```

```java
// server/src/test/java/kr/fees/persistence/MigrationTest.java
package kr.fees.persistence;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.assertThat;

class MigrationTest extends PgIntegrationTest {
    @Autowired JdbcTemplate jdbc;

    @Test void 스키마_핵심_테이블이_생성된다() {
        Integer n = jdbc.queryForObject("""
            SELECT count(*) FROM information_schema.tables
            WHERE table_name IN ('fee_rule','fee_schedule','fee_component','fee_enrollment',
                                 'fee_binding','fee_binding_history','account','product')""", Integer.class);
        assertThat(n).isEqualTo(8);
    }
}
```

Run: `./gradlew test` → Expected: PASS (Docker 필요)

- [ ] **Step 3: Commit** — `feat: Postgres 스키마 V1 — 배정판(세션 축 포함)·부여관계·이력·배치런`

---

## Phase 1 — 도메인 코어 (순수 자바, TDD)

### Task 3: 도메인 모델 + FeeCalculator

**Files:**
- Create: `server/src/main/java/kr/fees/domain/` — `AssetClass.java`, `LookupKey.java`, `RuleType.java`, `Payer.java`(CUSTOMER/COMPANY/EXEMPT), `Kind.java`(OWN/AGENCY/TAX), `RateType.java`(RATE/FLAT/BANDS), `RateBand.java`, `FeeComponent.java`, `FeeScheduleModel.java`, `Execution.java`, `FeeLine.java`, `FeeResult.java`, `FeeCalculator.java`
- Test: `server/src/test/java/kr/fees/domain/FeeCalculatorTest.java`

**Interfaces:**
- Produces:
  - `record Execution(BigDecimal price, long qty)` + `BigDecimal notional()`
  - `FeeResult FeeCalculator.calc(FeeScheduleModel s, Execution e)` — customerTotal/companyBorne/lines
  - `BigDecimal FeeCalculator.componentAmount(FeeComponent c, Execution e)`
- 포팅 원천: `src/domain/calc.ts`(로직), `src/domain/calc.test.ts`(케이스 전부 포팅)

- [ ] **Step 1: 실패 테스트 작성** (calc.test.ts 전 케이스 + 아래 대표 3개 필수)

```java
package kr.fees.domain;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class FeeCalculatorTest {
    private FeeComponent rate(String name, Payer p, double bp) {
        return new FeeComponent(name, Kind.OWN, p, RateType.RATE, BigDecimal.valueOf(bp), null, null, null);
    }

    @Test void 정률_구성요소는_거래대금_bp로_계산한다() {
        var s = new FeeScheduleModel("S1", "테스트", List.of(rate("자사", Payer.CUSTOMER, 25.0)));
        var r = FeeCalculator.calc(s, new Execution(BigDecimal.valueOf(100), 100)); // notional 10,000
        assertThat(r.customerTotal()).isEqualByComparingTo("25.00");   // 10000 * 25bp
    }

    @Test void 구간표는_정률과_정액을_동시에_더하고_최소수수료로_하한한다() {
        var band = new RateBand(BigDecimal.ZERO, null, BigDecimal.valueOf(14), BigDecimal.valueOf(13));
        var c = new FeeComponent("옵션", Kind.OWN, Payer.CUSTOMER, RateType.BANDS,
                                 null, null, List.of(band), BigDecimal.valueOf(1000));
        // price 50, qty 10 → notional 500 → 500*14bp=0.7 + 13*10=130 → 130.7 < min 1000 → 1000
        assertThat(FeeCalculator.componentAmount(c, new Execution(BigDecimal.valueOf(50), 10)))
            .isEqualByComparingTo("1000.00");
    }

    @Test void 면제는_0이고_회사부담은_고객합계에서_빠진다() {
        var s = new FeeScheduleModel("S2", "테스트", List.of(
            rate("자사", Payer.CUSTOMER, 20.0), rate("거래소", Payer.COMPANY, 5.0),
            rate("예탁원", Payer.EXEMPT, 3.0)));
        var r = FeeCalculator.calc(s, new Execution(BigDecimal.valueOf(100), 100));
        assertThat(r.customerTotal()).isEqualByComparingTo("20.00");
        assertThat(r.companyBorne()).isEqualByComparingTo("5.00");
        assertThat(r.lines().get(2).amount()).isEqualByComparingTo("0");
    }
}
```

- [ ] **Step 2: 실행 → 컴파일 실패 확인**
- [ ] **Step 3: 최소 구현** — calc.ts 1:1 이식. 구간 매칭 `price >= from && (to == null || price < to)`, 반올림 `setScale(2, RoundingMode.HALF_UP)`(구성요소·합계 각각)
- [ ] **Step 4: `./gradlew test` PASS**
- [ ] **Step 5: Commit** — `feat(domain): 요율표 평가(FeeCalculator) — 정률·정액·구간표·최소수수료·부담주체`

### Task 4: FeeKey + ScopeMatcher + RankKey

**Files:**
- Create: `server/src/main/java/kr/fees/domain/FeeKey.java`, `RuleScope.java`, `ScopeMatcher.java`, `RankKey.java`
- Test: `server/src/test/java/kr/fees/domain/ScopeMatcherTest.java`, `RankKeyTest.java`

**Interfaces:**
- Produces:
  - `record FeeKey(AssetClass assetClass, String exchange, LookupKey lookupKey, String session, String channel, String product)` — product는 파생만 non-null. 정적 팩토리 `FeeKey.of(...)`가 주식형 product를 null로 강제
  - `record RuleScope(AssetClass assetClass, Set<String> exchanges, Set<String> sessions, Set<LookupKey> lookupKeys, Set<String> products, Set<String> excludeProducts, Set<String> channels)` — null Set = 전체
  - `boolean ScopeMatcher.matches(RuleScope s, FeeKey k)`
  - `int RuleScope.specificity()` — 제약 차원 수(exchanges·sessions·lookupKeys·channels·products·excludeProducts 각 +1)
  - `BigDecimal RankKey.of(FeeScheduleModel s)` — CUSTOMER만: RATE=rate_bp 합, FLAT=flat 합, BANDS=첫 구간 rateBp+flat 합
- 포팅 원천: `src/domain/feeKey.ts`, `resolve.ts scopeMatchesKey`, `policyRank.ts rankKey/scopeSpecificity` + **v1.5 신규: lookupKey 매칭**

- [ ] **Step 1: 실패 테스트** — 필수 케이스: ① 주식형 FeeKey.of는 productCode를 줘도 product=null ② lookupKey 불일치 시 매칭 실패(FUTURES 룰 × OPTIONS 키) ③ 파생만 products/excludeProducts 검사 ④ null Set(전체)은 통과 ⑤ RankKey: 정률 25bp 요율표=25, 정액 $0.8=0.8 — v1.5 §3.3 예시값
- [ ] **Step 2: RED 확인 → Step 3: 구현 → Step 4: GREEN**
- [ ] **Step 5: Commit** — `feat(domain): 조회키(FeeKey·조회구분·세션)와 범위 매칭·순위값`

### Task 5: EligibilityGate (자격 게이트)

**Files:**
- Create: `server/src/main/java/kr/fees/domain/` — `RuleModel.java`, `Enrollment.java`, `AccountModel.java`, `EligibilityGate.java`
- Test: `server/src/test/java/kr/fees/domain/EligibilityGateTest.java`

**Interfaces:**
- Produces:
  - `record RuleModel(String id, String name, RuleType type, RuleStatus status, ApplyMode applyMode, LocalDate startDate, LocalDate endDate, BenefitKind benefitKind, Integer benefitMonths, String scheduleId, RuleScope scope, ConditionSpec condition, Set<String> targetAccountIds)`
  - `record Enrollment(long id, String accountId, String ruleId, EnrollmentStatus status, LocalDate validFrom, LocalDate validTo, QualifyType qualifyType, LocalDate enrolledAt)`
  - `record AccountModel(String id, String name, String grade, boolean dormantReturned, BigDecimal metric6mAsset, BigDecimal metric6mVolume)`
  - `boolean EligibilityGate.passes(RuleModel r, AccountModel a, List<Enrollment> enr, LocalDate today)`
- 게이트 규칙(스펙 §5 표): BASE=항상 / EVENT=isTarget AND isBenefitActive / **NEGOTIATED=해당 rule의 enrollment가 ACTIVE이고 validFrom≤today≤validTo**
- 포팅 원천: `src/domain/binding.ts isTarget·isBenefitActive`, `eligibility.ts evalCondition`, `dateutil.ts addMonths`(=`LocalDate.plusMonths`, 월말 클램프 동일)

- [ ] **Step 1: 실패 테스트** — 필수: ① NEGOTIATED는 enrollment 없으면 탈락, ACTIVE+기간내면 통과(v1.5 §3.3 T3 탈락/T2 통과 재현) ② EVENT 상대형: enrolledAt+months 안이면 룰 endDate 지나도 통과 ③ DORMANT_RETURN은 dormantReturned=true만 ④ TARGETED는 target_account_ids 포함 여부(null=전체) ⑤ condition 하드 게이트(threshold 미달 탈락)
- [ ] **Step 2~4: RED → 구현 → GREEN**
- [ ] **Step 5: Commit** — `feat(domain): 자격 게이트 — 협의=enrollment 유효성(일원화 모델)`

### Task 6: PolicyRanking + WinnerResolver (통합 랭킹·단일 경로)

**Files:**
- Create: `server/src/main/java/kr/fees/domain/PolicyRanking.java`, `RankedPolicy.java`, `WinnerResolver.java`, `Winner.java`
- Test: `server/src/test/java/kr/fees/domain/WinnerResolverTest.java`

**Interfaces:**
- Produces:
  - `record RankedPolicy(RuleModel rule, FeeScheduleModel schedule, BigDecimal rank)`
  - `List<RankedPolicy> PolicyRanking.build(List<RuleModel> rules, Map<String,FeeScheduleModel> schedules, LocalDate today)` — 편입: ACTIVE + 기간(상대형 EVENT는 기간 무시 편입, 유효성은 게이트가), **BASE+EVENT+NEGOTIATED 전부**. 정렬: rank↑ → 타입(NEGOTIATED=0<EVENT=1<BASE=2) → specificity↓ → ruleId
  - `record Winner(String scheduleId, String ruleId, RuleType sourceType, LocalDate validFrom, LocalDate validTo, String reason)`
  - `Optional<Winner> WinnerResolver.winnerFor(FeeKey key, AccountModel acct, List<Enrollment> enr, List<RankedPolicy> ranking, LocalDate today)` — 랭킹 순회, scope 매칭 + 게이트 통과 첫 정책. **협의 우선 분기 없음.** validFrom/To 산출: NEGOTIATED=enrollment 기간, EVENT 상대형=enrolledAt~enrolledAt+months, 그 외=룰 기간
- 이 태스크가 v1.5 전환의 심장 — `resolve.ts`의 협의 분기를 대체

- [ ] **Step 1: 실패 테스트** — v1.5 §3.3 예시를 그대로 재현(값은 스펙 §5.1 표):

```java
// 픽스처: R-BASE-01(OS 25bp), R-EVT-12(ETF 9bp, APPLICATION, 2026-07-01~12-31),
//         R-BASE-05(OD flat 2.5), R-NEGO-02(T2 0.8), R-NEGO-03(T3 0.5)
// enrollment: 9001(R-NEGO-02, ACTIVE, 2026-01-02~2026-12-31), 9002(R-EVT-12, enrolledAt 2026-07-01)
@Test void 해외ETF_셀은_이벤트가_협의없이_승자() { /* ETF 키 → R-EVT-12, EVENT */ }
@Test void ES선물_셀은_T3보다_싼_T2가_아니라_enrollment_보유한_T2가_승자() {
    // T3(0.5)가 랭킹 1위지만 enrollment 없음 → 탈락, T2(0.8) 승자, validTo=2026-12-31(enrollment 기간 전파)
}
@Test void ES옵션_셀은_협의_범위밖이라_기본() { /* lookupKey OPTIONS → R-BASE-05 */ }
@Test void 동률이면_협의_이벤트_기본_순() { /* rank 같은 세 룰 → NEGOTIATED 승 */ }
```

- [ ] **Step 2~4: RED → 구현 → GREEN**
- [ ] **Step 5: Commit** — `feat(domain): 통합 랭킹·승자 확정 단일 경로 — 협의 일원화(v1.5 §3)`

### Task 7: DominanceValidator + 역마진 경고

**Files:**
- Create: `server/src/main/java/kr/fees/domain/DominanceValidator.java`
- Test: `server/src/test/java/kr/fees/domain/DominanceValidatorTest.java`

**Interfaces:**
- Produces: `List<BigDecimal> probePrices(a, b)` / `boolean dominates(candidate, incumbent)` / `Optional<Failure> explainFailure(candidate, incumbent)` (record `Failure(BigDecimal price, BigDecimal candidateFee, BigDecimal incumbentFee)`) / `boolean reverseMargin(FeeScheduleModel s, Execution probe)` — companyBorne > OWN·CUSTOMER 수취분이면 true
- 포팅 원천: `src/domain/dominance.ts`(probe grid: 1·100·100000 + 구간 경계 ±0.01), `metrics.ts`(역마진). sampleExec: price→qty 10

- [ ] **Step 1~4: TDD** — 필수: ① 전 구간 싼 요율표는 지배 성립 ② 특정 구간에서 역전되면 실패 지점·차액 최대 지점 반환 ③ 회사부담>자사수취 역마진 감지
- [ ] **Step 5: Commit** — `feat(domain): 지배관계 검증·역마진 경고`

---

## Phase 2 — 저장소·시드

### Task 8: 저장소 계층 (JdbcTemplate)

**Files:**
- Create: `server/src/main/java/kr/fees/persistence/` — `RuleRepository.java`, `ScheduleRepository.java`, `EnrollmentRepository.java`, `AccountRepository.java`, `ProductRepository.java`, `BindingRepository.java`, `HistoryRepository.java`, `BatchRunRepository.java`, `Mappers.java`
- Test: `server/src/test/java/kr/fees/persistence/RepositoryTest.java`

**Interfaces:**
- Produces(핵심만):
  - `List<RuleModel> RuleRepository.findAll()` / `findActive(LocalDate)` / `insert(RuleModel)` / `updateStatus(id, RuleStatus)` — scope text[] ↔ `Set<String>`(NULL=전체), bands jsonb ↔ `List<RateBand>`(Jackson)
  - `Map<String,FeeScheduleModel> ScheduleRepository.findAllAsMap()` / `insert(FeeScheduleModel)`
  - `List<Enrollment> EnrollmentRepository.findByAccount(accountId)` / `findByRequestId` / `insert` / `approve(requestId, from, to)` / `extend(enrollmentId, newValidTo)`
  - `BindingRepository`: `List<BindingRow> findByAccount(accountId)` / `Optional<LookupResult> lookup(LookupParams)`(스펙 §4 계약 SQL) / `int[] batchInsert(List<BindingRow> sorted)` / `deleteByKeys`, `record BindingRow(...)` = fee_binding 1:1
- 규칙: SQL은 저장소 안에만. 도메인 record로 반환(엔티티 없음)

- [ ] **Step 1: 실패 테스트(RepositoryTest extends PgIntegrationTest)** — 룰 insert→findActive 왕복(scope 배열·bands jsonb 왕복 동일성), enrollment approve가 valid_from/to 세팅, binding batchInsert→lookup 계약 SQL이 구체 행 우선(§4 ORDER BY) 확인
- [ ] **Step 2~4: RED → 구현 → GREEN**
- [ ] **Step 5: Commit** — `feat(persistence): JdbcTemplate 저장소 — 룰·요율표·부여·배정판(커버링 조회)`

### Task 9: 시드 데이터 (V2__seed.sql, dev 전용 아님 — 테스트 픽스처 겸용이므로 공통)

**Files:**
- Create: `server/src/main/resources/db/migration/V2__seed.sql`
- Test: `server/src/test/java/kr/fees/persistence/SeedTest.java`

**Interfaces:**
- Produces: `src/store/mock.ts`의 데이터를 영문 코드값으로 번역한 시드 — 계좌(8041-2237-01 포함 전 계좌 + account_product_group), 품목(ES·GC 등 파생 + 주식형), 요율표·구성요소, 룰(BASE 자산군별 + 이벤트 + 협의 표준등급 T1~T3), enrollment(§3.3 시나리오 재현: 8041-2237-01에 T2·ETF 이벤트), qualify_policy
- 번역표: 스펙 §3. mock.ts의 한글 코드값('신청형'→APPLICATION, '정률'→RATE, '프리'→PRE, '센터'→BRANCH, '반대매매'→LIQUIDATION 등)
- 주의: mock.ts의 `NegoException` 데이터는 **협의 룰(NEGOTIATED)+enrollment로 변환**해 넣는다(§8 매핑)

- [ ] **Step 1: SeedTest 작성** — 계좌·룰·요율표 개수, 8041-2237-01의 enrollment 2건(T2·ETF) 존재 확인
- [ ] **Step 2~4: V2 작성 → GREEN**
- [ ] **Step 5: Commit** — `feat(persistence): 시드 — mock 데이터 영문 코드값 이관(협의는 룰+부여로 변환)`

---

## Phase 3 — 배정판 배치

### Task 10: 셀 유니버스 전개

**Files:**
- Create: `server/src/main/java/kr/fees/batch/CellUniverse.java`
- Test: `server/src/test/java/kr/fees/batch/CellUniverseTest.java`

**Interfaces:**
- Produces: `List<FeeKey> CellUniverse.cellsFor(String accountId, Set<AssetClass> openedGroups, List<ProductModel> products, List<RuleModel> activeRules)`
  - 파생: 상품군×거래소×품목 × {FUTURES, OPTIONS}
  - 주식형: OVERSEAS_STOCK=거래소×{STOCK,ETF}, DOMESTIC_STOCK={STOCK}, GOLD_SPOT={GOLD}, product='*'
  - 세션·채널: 기본 '*'. 활성 룰 중 scope가 세션/채널 한정인 룰이 매칭되는 셀에만 해당 세션/채널 구체 셀 추가(v1.5 §10.1 ②)
  - openedGroups에 없는 상품군 셀은 생성하지 않음(pruning)
- [ ] **Step 1~4: TDD** — 필수: ① 파생 품목×2(선물/옵션) ② 주식 product 없음 ③ MTS 한정 이벤트 존재 시 그 scope 셀에만 channel=MTS 행 추가 ④ 미개설 상품군 제외
- [ ] **Step 5: Commit** — `feat(batch): 셀 유니버스 전개 — 조회구분·세션/채널 조건부 분화·pruning`

### Task 11: 전체 재산출 (FULL_REBUILD)

**Files:**
- Create: `server/src/main/java/kr/fees/batch/BindingRebuilder.java`, `BindingDiff.java`
- Test: `server/src/test/java/kr/fees/batch/BindingRebuilderTest.java` (Testcontainers)

**Interfaces:**
- Produces: `BatchResult BindingRebuilder.fullRebuild(LocalDate baseDate)`
  1. 활성 룰+요율표 로드 → `PolicyRanking.build`
  2. 계좌 루프(**account_id 정렬 순서**) → 셀 전개 → `WinnerResolver.winnerFor` → 기대 행 생성
  3. 현행 판과 diff(키 기준) → insert/update/delete 배치 실행 + `fee_binding_history`(DAILY_REBUILD) + `batch_run` 기록
  - `record BatchResult(long inserted, updated, deleted, unchanged)`
- 정렬 적재 원칙: 기대 행을 PK 순 정렬 후 batchInsert(v1.5 §10.3)

- [ ] **Step 1: 실패 테스트** — 시드 기반: ① fullRebuild 후 8041-2237-01 판이 **기술설계서 v1.5 §6.2 표와 일치**(ES·GC FUTURES=T2 NEGOTIATED valid_to 2026-12-31 / ES OPTIONS=BASE / OVERSEAS_STOCK ETF=EVENT / STOCK=BASE) ② 재실행 시 unchanged만(멱등) ③ 룰 하나 종료 후 재실행 → 해당 셀 승자 교체 + history 적재
- [ ] **Step 2~4: RED → 구현 → GREEN**
- [ ] **Step 5: Commit** — `feat(batch): 배정판 전체 재산출 — diff·이력·정렬 적재(§6.2 재현 테스트)`

### Task 12: delta 배치 + 수시 증분

**Files:**
- Create: `server/src/main/java/kr/fees/batch/DeltaBatch.java`, `IncrementalBinder.java`
- Test: `server/src/test/java/kr/fees/batch/DeltaBatchTest.java`, `IncrementalBinderTest.java`

**Interfaces:**
- Produces:
  - `BatchResult DeltaBatch.run(LocalDate baseDate)` — 대상 셀 = `valid_to = baseDate-1`인 판 행의 셀 ∪ `start_date = baseDate`인 활성 룰 scope 셀. 그 셀만 winnerFor 재산출(트리거 DELTA)
  - `void IncrementalBinder.onRuleApproved(ruleId)` / `onRuleExpired(ruleId)` / `onNegoApproved(requestId)` / `onNegoExtended(enrollmentId)` / `onEnrollment(accountId, ruleId)` — 영향 계좌×scope 셀만 재산출, 각 트리거명으로 history
  - 셋 다 **fullRebuild와 같은 winnerFor·같은 upsert 경로** 사용(로직 한 벌)
- [ ] **Step 1~4: TDD** — 필수: ① 어제 만료 이벤트 셀이 delta에서 차순위로 복귀 ② 협의 승인 증분이 해당 계좌 판만 갱신(NEGO_APPROVED) ③ 증분 실패를 가정하고 fullRebuild가 보정(멱등 재확인)
- [ ] **Step 5: Commit** — `feat(batch): 일 delta·수시 증분 — 동일 승자확정 공유(§10 3층)`

---

## Phase 4 — REST API

### Task 13: 조회 API (lookup·calc·bindings·history·마스터)

**Files:**
- Create: `server/src/main/java/kr/fees/api/` — `LookupController.java`, `BindingController.java`, `MasterController.java`, `ApiError.java`(problem+json @ControllerAdvice)
- Test: `server/src/test/java/kr/fees/api/LookupApiTest.java` (@SpringBootTest + Testcontainers + TestRestTemplate)

**Interfaces:**
- Produces:
  - `GET /api/lookup?accountId&assetClass&lookupKey&exchange&session&product&channel&tradeDate` → `{scheduleId, sourceRuleId, sourceType}` (0건 → BASE 직해석 fallback, `fallback:true` 플래그)
  - `POST /api/calc` body `{scheduleId, price, qty}` → FeeResult(구성요소 명세)
  - `GET /api/accounts/{id}/bindings`, `GET /api/accounts/{id}/bindings/history`
  - `GET /api/accounts`, `GET /api/products`, `GET /api/schedules`, `GET /api/rules`, `GET /api/rules/{id}`
- [ ] **Step 1~4: TDD** — 필수: ① 시드+rebuild 후 lookup이 §6.2 값 반환 ② 구체 행(MTS) 우선 ③ 0건 fallback ④ calc 명세 금액 = FeeCalculatorTest 기대값
- [ ] **Step 5: Commit** — `feat(api): 원장 조회·요율 명세·배정판/이력 조회`

### Task 14: 룰 워크플로우 API (기안→검증→승인→활성)

**Files:**
- Create: `server/src/main/java/kr/fees/api/RuleController.java`, `server/src/main/java/kr/fees/api/RuleService.java`
- Test: `server/src/test/java/kr/fees/api/RuleWorkflowTest.java`

**Interfaces:**
- Produces:
  - `POST /api/rules`(DRAFT 생성, 요율표 포함 가능) → `POST /api/rules/{id}/validate` → `{dominance:{ok, failure?}, reverseMargin:{warning}}` — 같은 자산군 활성 BASE 대비 DominanceValidator 실행
  - `POST /api/rules/{id}/approve` — PENDING→ACTIVE + `IncrementalBinder.onRuleApproved` 동기 호출
  - `POST /api/rules/{id}/reject`, `POST /api/rules/{id}/expire`(조기종료 → onRuleExpired)
  - 지배관계 위반 룰 approve 시 400(problem+json, 위반 지점 포함)
- [ ] **Step 1~4: TDD** — 필수: ① 기안→검증→승인→활성 흐름 + 승인 직후 판 증분 반영 ② 역전 요율표는 approve 400 ③ 조기종료 → 판에서 차순위 복귀
- [ ] **Step 5: Commit** — `feat(api): 룰 워크플로우 — 지배관계 게이트·승인 시 증분 산출`

### Task 15: 협의 워크플로우 API (신청→자격→승인→연장)

**Files:**
- Create: `server/src/main/java/kr/fees/api/NegoController.java`, `NegoService.java`, `EnrollController.java`
- Test: `server/src/test/java/kr/fees/api/NegoWorkflowTest.java`

**Interfaces:**
- Produces:
  - `POST /api/nego/requests` body `{accountIds[], ruleId, rateAdjust?{componentSeq, rateBp|flatAmount}, requestedBy}` → 계좌별 자격 자동판정(qualify_policy vs 계좌 지표; 미충족은 `qualifyType:EXCEPTION` + reason 필수) → enrollment REQUESTED 묶음 생성(request_id), rateAdjust 있으면 파생 요율표 생성 + **지배관계 검증**
  - `GET /api/nego/requests?status=`, `POST /api/nego/requests/{requestId}/approve`(ACTIVE, valid_from=승인일, valid_to=+1년, `onNegoApproved`) / `reject`
  - `GET /api/nego/extension-candidates` — 그룹 축(주식형=상품군, 파생=품목), 각 계좌 재평가(유지/탈락 + 사유) — `negoExtension.ts` 로직 이식(협의=룰 모델로)
  - `POST /api/nego/extend` body `{enrollmentIds[], months}` — valid_to 연장 + condition_eval_log + `onNegoExtended`
  - `POST /api/enrollments` — 신청형 이벤트 가입(enrolled_at=오늘) + `onEnrollment`
- [ ] **Step 1~4: TDD** — 필수: ① 충족 계좌 MET·미충족 EXCEPTION(사유 없으면 400) ② 승인 → 판에 NEGOTIATED 행 + NEGO_APPROVED 이력 ③ 연장 후보: 자격 재충족=유지, 미충족(예외 아님)=탈락 ④ 연장 → valid_to 갱신 + 판 valid_to 전파
- [ ] **Step 5: Commit** — `feat(api): 협의 워크플로우 — 자격 자동판정·일괄 승인·연장 대상 산출`

### Task 16: 배치 트리거·대시보드 API

**Files:**
- Create: `server/src/main/java/kr/fees/api/BatchController.java`, `DashboardController.java`
- Test: `server/src/test/java/kr/fees/api/BatchApiTest.java`

**Interfaces:**
- Produces: `POST /api/batch/rebuild`, `POST /api/batch/delta` (body `{baseDate}` 기본 오늘) → BatchResult / `GET /api/batch/runs` / `GET /api/dashboard` → `{activeRules, pendingApprovals, activeNego, bindingRows, recentChanges[]}`
- [ ] **Step 1~4: TDD → Step 5: Commit** — `feat(api): 배치 트리거·대시보드 집계`

---

## Phase 5 — 프론트 전환

### Task 17: API 클라이언트 + 라벨 매핑 + 프록시

**Files:**
- Create: `src/api/client.ts`, `src/api/types.ts`(서버 DTO 타입)
- Modify: `vite.config.ts`(proxy `/api` → `http://localhost:8080`), `src/screens/labels.ts`(영문 코드값 ↔ 한글 라벨 전 코드 매핑 — 스펙 §3 표)
- Test: `src/api/client.test.ts`(fetch mock)

- [ ] **Step 1~4: TDD** — client.ts: `api.get/post` 래퍼(problem+json 에러 파싱), labels: `assetClassLabel('OVERSEAS_DERIV')==='해외파생'` 등 왕복 테스트
- [ ] **Step 5: Commit** — `feat(web): API 클라이언트·코드값 라벨 매핑·dev 프록시`

### Task 18: 스토어 전환 + 화면 연결

**Files:**
- Modify: `src/store/useStore.ts`(mock 초기화 → `api` 로딩·액션 후 재조회), `src/store/mock.ts`(dev 폴백으로 축소 or 삭제), 화면별: `Dashboard.tsx`(GET /api/dashboard), `Wizard.tsx`(POST /api/rules + validate), `Approvals.tsx`(approve/reject), `NegoRequest.tsx`/`NegoApproval.tsx`/`Negotiated.tsx`(nego API), `AccountView.tsx`(bindings/history — **배정판·이력 화면**), `FeeTrace.tsx`(lookup+calc), `PolicyPriority.tsx`(GET /api/rules 랭킹 뷰)
- Test: 기존 vitest 중 화면 로직 테스트를 API mock 기반으로 수정, 도메인 로직 테스트는 서버로 이관됐으므로 해당 파일 유지 여부는 화면 의존성 기준으로 정리(화면이 import하지 않는 `src/domain/*`은 삭제, import하는 것만 유지)

- [ ] **Step 1: 화면별 순차 전환(화면당 커밋)** — Dashboard → AccountView(배정판) → FeeTrace(lookup) → Wizard/Approvals → Nego 3종 → PolicyPriority
- [ ] **Step 2: `npm run build` + `npm test` GREEN**
- [ ] **Step 3: Commit(누적)** — `feat(web): <화면> 서버 API 전환`

---

## Phase 6 — E2E 검증·문서

### Task 19: E2E 시나리오 + README

**Files:**
- Create: `server/src/test/java/kr/fees/E2eScenarioTest.java`
- Modify: `README.md`(기동 방법: compose→gradlew→npm, 아키텍처 개요 갱신)

- [ ] **Step 1: E2E 테스트** — 스펙 §10 시나리오를 한 테스트 클래스에: 시드 → fullRebuild → §6.2 판 검증 → 협의 신청·승인 → 증분 검증 → 이벤트 조기종료 → delta → lookup/calc 검증
- [ ] **Step 2: 수동 기동 확인** — `docker compose up -d && (cd server && ./gradlew bootRun)` + `npm run dev` → 화면에서 §6.2 계좌 조회
- [ ] **Step 3: README 갱신 → Commit** — `docs: 기동 가이드·아키텍처 갱신 (Spring Boot + Postgres)`

---

## Self-Review 결과

- 스펙 커버리지: §1~§10 전부 태스크 매핑 확인(§4→T2·T8, §5→T3~T7, §6→T10~T12, §7→T13~T16, §8→T17~T18, §9→각 태스크 TDD, §10→T19). 계좌·종목 마스터 동기화 배치는 스펙 비범위로 제외 일치.
- 타입 일관성: `WinnerResolver.winnerFor` 시그니처가 T6(정의)=T11·T12(사용) 동일, `BatchResult`·`RankedPolicy`·`Enrollment` 명칭 통일 확인.
- 플레이스홀더: 대표 테스트는 코드로 제시, 전수 케이스는 TS 테스트 파일을 기대값 스펙으로 명시(파일 경로 지정) — 실행자가 열어 포팅.
