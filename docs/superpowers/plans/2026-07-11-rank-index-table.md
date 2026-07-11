# 순위 사전 산정 테이블화 (rank_value + 후보 색인) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정책 순위 산정을 "배치/증분이 뜰 때마다 메모리 재계산"에서 "승인 시점 1회 계산 → 물리 테이블 상주 → 모든 경로는 읽기만"으로 옮긴다. 판정 의미론은 불변 — 기존 테스트가 전부 그대로 통과해야 한다.

**Architecture:** ① `fee_rule.rank_value` 컬럼: 승인 트랜잭션에서 `RankKey.of(요율표)`를 한 번 계산해 저장. ② 신규 소형 테이블 `fee_rule_candidate_index`: 조합(자산군·조회구분·거래소·품목)별 후보 순위 목록(계좌 무관), 승인·종료 시 전면 재생성(전체 MB 규모 — §10.4의 "걸리는 조합만 갱신"은 추후 최적화). ③ 배치·증분·화면·추적·미스경로 다섯 소비자는 `PolicyRanking.build`(즉석 계산) 대신 저장 순위를 읽는 `RankingRepository`를 쓴다. 날짜 종속 멤버십(기간 필터, 상대형 이벤트 예외)은 읽기 시점 필터로 남고, **순서만** 저장된다.

**Tech Stack:** Spring Boot 3 (JdbcTemplate, Flyway), PostgreSQL 16, JUnit 5 + AssertJ + Testcontainers(Podman 소켓).

## Global Constraints

- 판정 의미론 불변: 같은 입력 → 같은 배정판. **기존 테스트 전원 무수정 통과**가 완료 조건.
- 순위 산식의 단일 출처는 `RankKey.java` — SQL로 산식을 복제하지 않는다(백필도 Java 경로).
- 테스트가 룰을 ACTIVE로 직접 INSERT하는 경우(승인 경로 우회)를 위해 읽기 경로는 `rank_value IS NULL`일 때 즉석 계산 fallback + WARN 로그를 유지한다. 운영 경로(승인/종료/기동/재적재 API)는 항상 채워 fallback이 실전에서 발화하지 않게 한다.
- 요율표는 승인 후 불변 — 현재 `ScheduleRepository`에 UPDATE 경로가 없어 이미 성립. **요율표 수정 기능을 추가하게 되면 반드시 색인 재적재를 강제할 것** (이 플랜 범위 밖, 주석으로 남김).
- 테스트 실행: `cd /Users/yujin-an/dev/fees/server && ./gradlew test --tests '<클래스>'`. 통합 테스트는 `PgIntegrationTest` 상속(@Transactional 롤백, postgres:16 컨테이너 공유).
- 커밋 메시지는 저장소 관례(한국어, `feat(...)`/`test(...)` 프리픽스) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러.
- 브랜치: `feature/v1-java-postgres` 위에서 진행.

---

### Task 1: V5 마이그레이션 — rank_value 컬럼 + fee_rule_candidate_index 테이블

**Files:**
- Create: `server/src/main/resources/db/migration/V5__rank_index.sql`
- Test: 기존 `server/src/test/java/kr/fees/persistence/MigrationTest.java` (무수정 — Flyway가 새 파일을 적용하는지만 확인)

**Interfaces:**
- Consumes: 기존 `fee_rule` 테이블 (V1__schema.sql:55).
- Produces: `fee_rule.rank_value numeric(18,4) NULL` 컬럼, `fee_rule_candidate_index` 테이블. 이후 모든 태스크가 이 두 구조에 의존한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- V5: 순위 사전 산정 물리화 (기술설계서 §10.4 1단계).
-- 순위값은 승인 시점에 확정되어 fee_rule 컬럼으로 상주하고,
-- 조합(자산군·조회구분·거래소·품목)별 후보 순위는 소형 색인 테이블로 상주한다.
-- 판정 로직은 불변 — 배치·증분·화면은 저장 순위를 읽기만 한다.
-- 주의: 요율표(fee_component)는 승인 후 불변이 전제. 수정 기능 도입 시 색인 재적재 강제 필요.

ALTER TABLE fee_rule ADD COLUMN rank_value numeric(18,4);

CREATE TABLE fee_rule_candidate_index (
    asset_class   text NOT NULL,
    lookup_key    text NOT NULL,
    exchange_code text NOT NULL DEFAULT '*',
    product_code  text NOT NULL DEFAULT '*',   -- 주식형은 '*'
    rank_position int  NOT NULL,               -- 조합 내 순위(1..n), 재생성 시 부여
    rule_id       text NOT NULL REFERENCES fee_rule(rule_id),
    rank_value    numeric(18,4) NOT NULL,
    rule_type     text NOT NULL,
    start_date    date NOT NULL,               -- 읽기 시점 기간 필터용 비정규화
    end_date      date NOT NULL,
    benefit_kind  text NOT NULL,               -- RELATIVE 이벤트 멤버십 예외 필터용
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_class, lookup_key, exchange_code, product_code, rank_position)
);

CREATE INDEX ix_candidate_rule ON fee_rule_candidate_index(rule_id);
```

- [ ] **Step 2: 마이그레이션 적용 확인**

Run: `cd /Users/yujin-an/dev/fees/server && ./gradlew test --tests 'kr.fees.persistence.MigrationTest'`
Expected: PASS (Flyway가 V5까지 적용, 스키마 검증 통과)

- [ ] **Step 3: Commit**

```bash
git add server/src/main/resources/db/migration/V5__rank_index.sql
git commit -m "feat(schema): V5 — fee_rule.rank_value + 조합별 후보 색인 테이블

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: ComboUniverse — 계좌 무관 색인 조합 열거 + 후보 판정

**Files:**
- Create: `server/src/main/java/kr/fees/batch/ComboUniverse.java`
- Modify: `server/src/main/java/kr/fees/batch/CellUniverse.java:71` (`stockLookupKeys` `private` → 패키지 가시성 `static`)
- Test: `server/src/test/java/kr/fees/batch/ComboUniverseTest.java`

**Interfaces:**
- Consumes: `CellUniverse.stockLookupKeys(AssetClass)` (가시성 변경), `RuleScope`, `ProductModel(assetClass, exchange, code, name, currency, sessions)`.
- Produces:
  - `ComboUniverse.Combo(AssetClass assetClass, LookupKey lookupKey, String exchange, String product)` — record. 주식형은 `product == null`, exchange는 `"*"` 또는 구체값.
  - `static List<Combo> enumerate(List<ProductModel> products, List<RuleModel> activeRules)`
  - `static boolean isCandidate(RuleScope scope, Combo combo)`

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package kr.fees.batch;

import kr.fees.domain.*;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class ComboUniverseTest {

    private final List<ProductModel> products = List.of(
        new ProductModel(AssetClass.OVERSEAS_DERIV, "CME", "ES", "E-mini", "USD", List.of("REGULAR")),
        new ProductModel(AssetClass.OVERSEAS_DERIV, "CME", "GC", "Gold", "USD", List.of("REGULAR")));

    private RuleModel rule(String id, RuleScope scope) {
        return new RuleModel(id, id, RuleType.BASE, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31), BenefitKind.CALENDAR, null, "S", scope, null, null);
    }

    @Test
    void 파생_조합은_품목마다_선물옵션_둘() {
        var combos = ComboUniverse.enumerate(products, List.of());
        var deriv = combos.stream().filter(c -> c.assetClass() == AssetClass.OVERSEAS_DERIV).toList();
        // ES,GC × {FUTURES,OPTIONS} = 4, exchange 는 품목 마스터의 CME
        assertThat(deriv).hasSize(4);
        assertThat(deriv).allSatisfy(c -> {
            assertThat(c.exchange()).isEqualTo("CME");
            assertThat(c.product()).isIn("ES", "GC");
        });
    }

    @Test
    void 주식형_조합은_기본_별표_거래소이고_룰이_한정하면_거래소가_늘어난다() {
        var krxRule = rule("R-KRX", new RuleScope(AssetClass.DOMESTIC_STOCK,
            Set.of("KRX"), null, null, null, Set.of(), null));
        var combos = ComboUniverse.enumerate(List.of(), List.of(krxRule));
        var ds = combos.stream().filter(c -> c.assetClass() == AssetClass.DOMESTIC_STOCK).toList();
        // DOMESTIC_STOCK 은 STOCK 하나 × 거래소 {*, KRX} = 2, 품목 없음
        assertThat(ds).hasSize(2);
        assertThat(ds).allSatisfy(c -> assertThat(c.product()).isNull());
        assertThat(ds).extracting(ComboUniverse.Combo::exchange).containsExactlyInAnyOrder("*", "KRX");
    }

    @Test
    void KRX한정_룰은_별표_조합과_타거래소_조합의_후보가_아니다() {
        var krxScope = new RuleScope(AssetClass.DOMESTIC_STOCK, Set.of("KRX"), null, null, null, Set.of(), null);
        var star = new ComboUniverse.Combo(AssetClass.DOMESTIC_STOCK, LookupKey.STOCK, "*", null);
        var krx  = new ComboUniverse.Combo(AssetClass.DOMESTIC_STOCK, LookupKey.STOCK, "KRX", null);
        var nxt  = new ComboUniverse.Combo(AssetClass.DOMESTIC_STOCK, LookupKey.STOCK, "NXT", null);
        assertThat(ComboUniverse.isCandidate(krxScope, star)).isFalse(); // '*' 키는 한정 룰 통과 못함
        assertThat(ComboUniverse.isCandidate(krxScope, krx)).isTrue();
        assertThat(ComboUniverse.isCandidate(krxScope, nxt)).isFalse();
    }

    @Test
    void 채널만_한정한_룰은_모든_조합의_후보다() {
        // 채널·세션은 색인 키 축이 아님 — 셀 단계(ScopeMatcher)가 처리
        var arsScope = new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), Set.of("ARS"));
        var star = new ComboUniverse.Combo(AssetClass.DOMESTIC_STOCK, LookupKey.STOCK, "*", null);
        assertThat(ComboUniverse.isCandidate(arsScope, star)).isTrue();
    }

    @Test
    void 파생_후보는_품목_스코프와_제외품목을_따른다() {
        var esOnly = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null, Set.of("ES"), Set.of(), null);
        var exclGc = new RuleScope(AssetClass.OVERSEAS_DERIV, null, null, null, null, Set.of("GC"), null);
        var es = new ComboUniverse.Combo(AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES, "CME", "ES");
        var gc = new ComboUniverse.Combo(AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES, "CME", "GC");
        assertThat(ComboUniverse.isCandidate(esOnly, es)).isTrue();
        assertThat(ComboUniverse.isCandidate(esOnly, gc)).isFalse();
        assertThat(ComboUniverse.isCandidate(exclGc, gc)).isFalse();
        assertThat(ComboUniverse.isCandidate(exclGc, es)).isTrue();
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'kr.fees.batch.ComboUniverseTest'`
Expected: COMPILE FAIL — `ComboUniverse` 미존재

- [ ] **Step 3: 구현**

`CellUniverse.java:71`의 `private static List<LookupKey> stockLookupKeys(` → `static List<LookupKey> stockLookupKeys(` 로 변경(같은 패키지 재사용, 로직 한 벌).

```java
package kr.fees.batch;

import kr.fees.domain.*;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 색인 조합(자산군·조회구분·거래소·품목) 열거 — CellUniverse 의 계좌 무관 부분 (§10.4).
 * 파생 = 품목 마스터 × {선물, 옵션} (거래소는 품목의 것).
 * 주식형 = 조회구분 × 거래소 {'*' ∪ 활성 룰이 한정한 거래소들}, 품목 없음.
 * 채널·세션은 색인 키 축이 아니다 — 셀 단계(ScopeMatcher)가 처리한다.
 */
public final class ComboUniverse {

    private static final String ALL = "*";

    private ComboUniverse() {}

    public record Combo(AssetClass assetClass, LookupKey lookupKey, String exchange, String product) {}

    public static List<Combo> enumerate(List<ProductModel> products, List<RuleModel> activeRules) {
        LinkedHashSet<Combo> out = new LinkedHashSet<>();
        for (AssetClass ac : AssetClass.values()) {
            if (ac.isDerivative()) {
                for (ProductModel p : products) {
                    if (p.assetClass() != ac) continue;
                    for (LookupKey lk : List.of(LookupKey.FUTURES, LookupKey.OPTIONS)) {
                        out.add(new Combo(ac, lk, p.exchange(), p.code()));
                    }
                }
            } else {
                Set<String> exchanges = new LinkedHashSet<>(List.of(ALL));
                for (RuleModel r : activeRules) {
                    if (r.scope().assetClass() == ac && r.scope().exchanges() != null) {
                        exchanges.addAll(r.scope().exchanges());
                    }
                }
                for (LookupKey lk : CellUniverse.stockLookupKeys(ac)) {
                    for (String ex : exchanges) {
                        out.add(new Combo(ac, lk, ex, null));
                    }
                }
            }
        }
        return new ArrayList<>(out);
    }

    /** 조합 계열 후보 판정 — CellUniverse.matchesFamily 와 동일 의미론 + 주식형 거래소 축. */
    public static boolean isCandidate(RuleScope s, Combo c) {
        if (s.assetClass() != c.assetClass()) return false;
        if (s.lookupKeys() != null && !s.lookupKeys().contains(c.lookupKey())) return false;
        if (s.exchanges() != null) {
            // '*' 조합은 한정 룰을 통과시키지 않는다 (ScopeMatcher 와 동일 원칙)
            if (ALL.equals(c.exchange()) || !s.exchanges().contains(c.exchange())) return false;
        }
        if (c.product() != null) { // 파생만 품목 차원
            if (s.products() != null && !s.products().contains(c.product())) return false;
            if (s.excludeProducts().contains(c.product())) return false;
        }
        return true;
    }
}
```

- [ ] **Step 4: 통과 확인 (기존 CellUniverse 테스트 포함)**

Run: `./gradlew test --tests 'kr.fees.batch.ComboUniverseTest' --tests 'kr.fees.batch.CellUniverseTest'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/kr/fees/batch/ComboUniverse.java \
        server/src/main/java/kr/fees/batch/CellUniverse.java \
        server/src/test/java/kr/fees/batch/ComboUniverseTest.java
git commit -m "feat(batch): ComboUniverse — 계좌 무관 색인 조합 열거·후보 판정

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: PolicyRanking 리팩터 — comparator/inRanking 공개 + fromStored

**Files:**
- Modify: `server/src/main/java/kr/fees/domain/PolicyRanking.java`
- Test: `server/src/test/java/kr/fees/domain/PolicyRankingStoredTest.java` (신규)

**Interfaces:**
- Consumes: `RankedPolicy(RuleModel rule, FeeScheduleModel schedule, BigDecimal rank)`, `RankKey.of(FeeScheduleModel)`.
- Produces:
  - `public static Comparator<RankedPolicy> comparator()` — 기존 4키 정렬(①rank ②tieOrder ③specificity 역순 ④ruleId)의 단일 출처.
  - `public static boolean inRanking(RuleModel r, LocalDate today)` — (기존 private 공개) ACTIVE + 기간, 상대형 이벤트 예외.
  - `public static List<RankedPolicy> fromStored(List<RuleModel> rules, Map<String,FeeScheduleModel> schedules, Map<String,BigDecimal> storedRanks, LocalDate today)` — 저장 순위값 사용, 없으면 `RankKey.of` fallback + WARN.

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package kr.fees.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class PolicyRankingStoredTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 7, 11);

    private RuleModel rule(String id, RuleType type, String scheduleId) {
        var scope = new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null);
        return new RuleModel(id, id, type, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31), BenefitKind.CALENDAR, null,
            scheduleId, scope, null, null);
    }

    private FeeScheduleModel schedule(String id, double customerBp) {
        return new FeeScheduleModel(id, id, List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE,
                BigDecimal.valueOf(customerBp), null, null, null)));
    }

    @Test
    void 저장_순위값으로_정렬하고_결과가_build와_동일하다() {
        var rules = List.of(rule("R-B", RuleType.BASE, "S-B"), rule("R-E", RuleType.EVENT, "S-E"));
        var schedules = Map.of("S-B", schedule("S-B", 1.5), "S-E", schedule("S-E", 0.9));
        var stored = Map.of("R-B", new BigDecimal("1.5000"), "R-E", new BigDecimal("0.9000"));

        var fromStored = PolicyRanking.fromStored(rules, schedules, stored, TODAY);
        var fromBuild = PolicyRanking.build(rules, schedules, TODAY);

        assertThat(fromStored).extracting(p -> p.rule().id())
            .containsExactlyElementsOf(fromBuild.stream().map(p -> p.rule().id()).toList());
        assertThat(fromStored.get(0).rank()).isEqualByComparingTo("0.9000"); // 저장값 그대로
    }

    @Test
    void 저장값이_없는_룰은_즉석_계산으로_fallback() {
        var rules = List.of(rule("R-B", RuleType.BASE, "S-B"));
        var schedules = Map.of("S-B", schedule("S-B", 1.5));

        var out = PolicyRanking.fromStored(rules, schedules, Map.of(), TODAY);

        assertThat(out).hasSize(1);
        assertThat(out.get(0).rank()).isEqualByComparingTo("1.5"); // RankKey.of fallback
    }

    @Test
    void 기간_밖_룰은_저장값이_있어도_편입되지_않는다() {
        var expired = new RuleModel("R-X", "X", RuleType.EVENT, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2025, 1, 1), LocalDate.of(2025, 12, 31), BenefitKind.CALENDAR, null, "S-B",
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null), null, null);
        var out = PolicyRanking.fromStored(List.of(expired), Map.of("S-B", schedule("S-B", 1.5)),
            Map.of("R-X", BigDecimal.ONE), TODAY);
        assertThat(out).isEmpty(); // 멤버십(기간)은 읽기 시점 판정
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'kr.fees.domain.PolicyRankingStoredTest'`
Expected: COMPILE FAIL — `fromStored` 미존재

- [ ] **Step 3: 구현 — PolicyRanking.java 전체를 아래로 교체**

```java
package kr.fees.domain;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 통합 우선순위 랭킹 (기술설계서 v1.5 §5.1). BASE+EVENT+NEGOTIATED 를 한 순위에 담는다.
 * 정렬: ① rank(요율 최저) ② 타입(협의>이벤트>기본) ③ 범위 구체성(높은 쪽) ④ 룰ID(결정성).
 * build = 즉석 계산(순위 확정 시점에만 사용), fromStored = 승인 시점에 저장된 rank_value 를 읽어 구성(§10.4).
 */
public final class PolicyRanking {

    private static final Logger LOG = LoggerFactory.getLogger(PolicyRanking.class);

    private PolicyRanking() {}

    /** 4키 정렬의 단일 출처. */
    public static Comparator<RankedPolicy> comparator() {
        return Comparator
            .comparing(RankedPolicy::rank)
            .thenComparingInt((RankedPolicy p) -> p.rule().type().tieOrder())
            .thenComparing((RankedPolicy p) -> p.rule().scope().specificity(), Comparator.reverseOrder())
            .thenComparing(p -> p.rule().id());
    }

    public static List<RankedPolicy> build(List<RuleModel> rules, Map<String, FeeScheduleModel> schedules, LocalDate today) {
        return rules.stream()
            .filter(r -> inRanking(r, today))
            .map(r -> {
                FeeScheduleModel s = schedules.get(r.scheduleId());
                return s == null ? null : new RankedPolicy(r, s, RankKey.of(s));
            })
            .filter(Objects::nonNull)
            .sorted(comparator())
            .toList();
    }

    /**
     * 저장 순위값(fee_rule.rank_value)으로 랭킹 구성 — 배치·증분·화면의 표준 경로.
     * 저장값이 없는 룰(승인 경로를 우회해 ACTIVE 로 삽입된 시드·테스트 픽스처)은
     * 즉석 계산으로 fallback 하고 WARN 을 남긴다. 운영 경로는 승인/기동 시 항상 채운다.
     */
    public static List<RankedPolicy> fromStored(List<RuleModel> rules, Map<String, FeeScheduleModel> schedules,
                                                Map<String, BigDecimal> storedRanks, LocalDate today) {
        return rules.stream()
            .filter(r -> inRanking(r, today))
            .map(r -> {
                FeeScheduleModel s = schedules.get(r.scheduleId());
                if (s == null) return null;
                BigDecimal rank = storedRanks.get(r.id());
                if (rank == null) {
                    LOG.warn("rank_value 미저장 — 즉석 계산 fallback: {}", r.id());
                    rank = RankKey.of(s);
                }
                return new RankedPolicy(r, s, rank);
            })
            .filter(Objects::nonNull)
            .sorted(comparator())
            .toList();
    }

    /**
     * 순위 편입 조건 — ACTIVE + 기간. 단 상대형 이벤트는 기간이 계좌별 가입일 기준이라
     * 룰 기간(신청 마감)이 지나도 편입하고, 실제 유효는 게이트가 계좌별로 판정한다.
     */
    public static boolean inRanking(RuleModel r, LocalDate today) {
        if (r.status() != RuleStatus.ACTIVE) return false;
        if (r.type() == RuleType.EVENT && r.benefitKind() == BenefitKind.RELATIVE) return true;
        return !today.isBefore(r.startDate()) && !today.isAfter(r.endDate());
    }
}
```

- [ ] **Step 4: 통과 확인 (전체 도메인 테스트)**

Run: `./gradlew test --tests 'kr.fees.domain.*'`
Expected: PASS (기존 WinnerResolverTest 등 포함)

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/kr/fees/domain/PolicyRanking.java \
        server/src/test/java/kr/fees/domain/PolicyRankingStoredTest.java
git commit -m "feat(domain): PolicyRanking.fromStored — 저장 순위값 기반 랭킹 구성

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: RankIndexService — 승인 시점 순위 확정·색인 전면 재생성

**Files:**
- Create: `server/src/main/java/kr/fees/batch/RankIndexService.java`
- Test: `server/src/test/java/kr/fees/batch/RankIndexServiceTest.java`

**Interfaces:**
- Consumes: `RuleRepository.findActive(LocalDate)`, `ScheduleRepository.findAllAsMap()`, `ProductRepository.findAll()`, `ComboUniverse.enumerate/isCandidate` (Task 2), `PolicyRanking.comparator()` (Task 3), `RankKey.of`.
- Produces:
  - `RankIndexService.RebuildSummary(int rulesStamped, int combos, int indexRows)` — record.
  - `@Transactional public RebuildSummary rebuildAll(LocalDate today)` — ① 활성 룰 전건 `fee_rule.rank_value` UPDATE ② 색인 DELETE 후 전면 재생성(키 정렬 순 INSERT).

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package kr.fees.batch;

import kr.fees.persistence.PgIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RankIndexServiceTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired RankIndexService rankIndex;
    @Autowired JdbcTemplate jdbc;

    @Test
    void rebuildAll이_활성_룰_전건에_rank_value를_채운다() {
        rankIndex.rebuildAll(BASE);
        Integer missing = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule WHERE rule_status = 'ACTIVE' AND rank_value IS NULL", Integer.class);
        assertThat(missing).isZero();
    }

    @Test
    void 색인은_조합마다_순위값_오름차순으로_적재된다() {
        rankIndex.rebuildAll(BASE);
        // 임의 조합 하나를 잡아 rank_position 순서 == rank_value 오름차순(동률 시 rule_id) 확인
        List<BigDecimal> values = jdbc.queryForList("""
            SELECT rank_value FROM fee_rule_candidate_index
            WHERE (asset_class, lookup_key, exchange_code, product_code) IN (
                SELECT asset_class, lookup_key, exchange_code, product_code
                FROM fee_rule_candidate_index GROUP BY 1,2,3,4 HAVING count(*) >= 2 LIMIT 1)
            ORDER BY rank_position""", BigDecimal.class);
        assertThat(values).isSorted();
    }

    @Test
    void 색인_후보는_조합_계열_판정을_따른다() {
        rankIndex.rebuildAll(BASE);
        // 파생 품목 조합의 후보는 모두 그 자산군 룰이어야 한다
        Integer crossed = jdbc.queryForObject("""
            SELECT count(*) FROM fee_rule_candidate_index i
            JOIN fee_rule r ON r.rule_id = i.rule_id
            WHERE r.scope_asset_class <> i.asset_class""", Integer.class);
        assertThat(crossed).isZero();
    }

    @Test
    void 재실행해도_결과가_같다_결정성() {
        rankIndex.rebuildAll(BASE);
        List<String> first = jdbc.queryForList(
            "SELECT rule_id FROM fee_rule_candidate_index ORDER BY asset_class, lookup_key, exchange_code, product_code, rank_position",
            String.class);
        rankIndex.rebuildAll(BASE);
        List<String> second = jdbc.queryForList(
            "SELECT rule_id FROM fee_rule_candidate_index ORDER BY asset_class, lookup_key, exchange_code, product_code, rank_position",
            String.class);
        assertThat(second).containsExactlyElementsOf(first);
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'kr.fees.batch.RankIndexServiceTest'`
Expected: COMPILE FAIL — `RankIndexService` 미존재

- [ ] **Step 3: 구현**

```java
package kr.fees.batch;

import kr.fees.domain.*;
import kr.fees.persistence.ProductRepository;
import kr.fees.persistence.RuleRepository;
import kr.fees.persistence.ScheduleRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * 순위 사전 산정 (§10.4 1단계). 승인·종료 트랜잭션에서 호출되어
 * ① 활성 룰 전건의 rank_value 를 확정 저장하고 ② 조합별 후보 색인을 전면 재생성한다.
 * 색인 전체가 MB 규모라 전면 재생성이 단순·결정적이다("걸리는 조합만 갱신"은 추후 최적화).
 * 색인에는 기간 필터를 적용하지 않는다 — 멤버십(기간)은 읽기 시점 판정, 순서만 저장.
 */
@Service
public class RankIndexService {

    private final RuleRepository rules;
    private final ScheduleRepository schedules;
    private final ProductRepository products;
    private final JdbcTemplate jdbc;

    public RankIndexService(RuleRepository rules, ScheduleRepository schedules,
                            ProductRepository products, JdbcTemplate jdbc) {
        this.rules = rules;
        this.schedules = schedules;
        this.products = products;
        this.jdbc = jdbc;
    }

    public record RebuildSummary(int rulesStamped, int combos, int indexRows) {}

    @Transactional
    public RebuildSummary rebuildAll(LocalDate today) {
        List<RuleModel> active = rules.findActive(today);
        Map<String, FeeScheduleModel> schedMap = schedules.findAllAsMap();

        // ① 순위값 확정 저장 — 산식의 단일 출처는 RankKey
        Map<String, BigDecimal> ranks = new LinkedHashMap<>();
        for (RuleModel r : active) {
            FeeScheduleModel s = schedMap.get(r.scheduleId());
            if (s == null) continue;
            BigDecimal v = RankKey.of(s);
            jdbc.update("UPDATE fee_rule SET rank_value = ? WHERE rule_id = ?", v, r.id());
            ranks.put(r.id(), v);
        }

        // ② 조합별 후보 색인 전면 재생성 (키 정렬 순 적재)
        jdbc.update("DELETE FROM fee_rule_candidate_index");
        List<RankedPolicy> allRanked = active.stream()
            .map(r -> {
                FeeScheduleModel s = schedMap.get(r.scheduleId());
                return s == null ? null : new RankedPolicy(r, s, ranks.get(r.id()));
            })
            .filter(Objects::nonNull)
            .sorted(PolicyRanking.comparator())
            .toList();

        List<ComboUniverse.Combo> combos = ComboUniverse.enumerate(products.findAll(), active);
        int rows = 0;
        for (ComboUniverse.Combo combo : combos) {
            int pos = 0;
            for (RankedPolicy p : allRanked) {
                if (!ComboUniverse.isCandidate(p.rule().scope(), combo)) continue;
                jdbc.update("""
                    INSERT INTO fee_rule_candidate_index(asset_class, lookup_key, exchange_code, product_code,
                        rank_position, rule_id, rank_value, rule_type, start_date, end_date, benefit_kind)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    combo.assetClass().name(), combo.lookupKey().name(), combo.exchange(),
                    combo.product() == null ? "*" : combo.product(),
                    ++pos, p.rule().id(), p.rank(), p.rule().type().name(),
                    p.rule().startDate(), p.rule().endDate(), p.rule().benefitKind().name());
                rows++;
            }
        }
        return new RebuildSummary(ranks.size(), combos.size(), rows);
    }
}
```

- [ ] **Step 4: 통과 확인**

Run: `./gradlew test --tests 'kr.fees.batch.RankIndexServiceTest'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/kr/fees/batch/RankIndexService.java \
        server/src/test/java/kr/fees/batch/RankIndexServiceTest.java
git commit -m "feat(batch): RankIndexService — 승인 시점 rank_value 확정 + 후보 색인 재생성

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: RankingRepository + CandidateIndexRepository — 저장 순위 읽기 경로

**Files:**
- Create: `server/src/main/java/kr/fees/persistence/RankingRepository.java`
- Create: `server/src/main/java/kr/fees/persistence/CandidateIndexRepository.java`
- Test: `server/src/test/java/kr/fees/persistence/RankingRepositoryTest.java`

**Interfaces:**
- Consumes: `ScheduleRepository.findAllAsMap()`, `PolicyRanking.fromStored/build` (Task 3), Task 1 스키마, Task 4 `RankIndexService`.
- Produces:
  - `RankingRepository.ranking(List<RuleModel> active, LocalDate today)` → `List<RankedPolicy>` — 소비자들이 기존 `PolicyRanking.build(active, schedMap, date)` 한 줄을 이걸로 교체.
  - `RankingRepository.storedRanks()` → `Map<String, BigDecimal>`.
  - `CandidateIndexRepository.candidates(AssetClass, LookupKey, String exchange, String product, LocalDate today)` → `List<String>` (rule_id, rank_position 순).
  - `CandidateIndexRepository.isEmpty()` → `boolean`.

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package kr.fees.persistence;

import kr.fees.batch.RankIndexService;
import kr.fees.domain.PolicyRanking;
import kr.fees.domain.RankedPolicy;
import kr.fees.domain.RuleModel;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RankingRepositoryTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired RankingRepository rankings;
    @Autowired RuleRepository rules;
    @Autowired ScheduleRepository schedules;
    @Autowired RankIndexService rankIndex;
    @Autowired CandidateIndexRepository candidateIndex;

    @Test
    void 저장_랭킹이_즉석_계산_랭킹과_동일하다_동치성() {
        rankIndex.rebuildAll(BASE);
        List<RuleModel> active = rules.findActive(BASE);

        List<RankedPolicy> stored = rankings.ranking(active, BASE);
        List<RankedPolicy> computed = PolicyRanking.build(active, schedules.findAllAsMap(), BASE);

        assertThat(stored).extracting(p -> p.rule().id())
            .containsExactlyElementsOf(computed.stream().map(p -> p.rule().id()).toList());
        for (int i = 0; i < stored.size(); i++) {
            assertThat(stored.get(i).rank()).isEqualByComparingTo(computed.get(i).rank());
        }
    }

    @Test
    void 색인_후보_조회는_기간을_필터하고_순위순으로_돌려준다() {
        rankIndex.rebuildAll(BASE);
        assertThat(candidateIndex.isEmpty()).isFalse();
        // 시드에 존재하는 임의 조합 하나에 대해: 후보가 있고, 전건 ACTIVE·기간 유효
        var anyCombo = jdbcCombo();
        List<String> ids = candidateIndex.candidates(anyCombo.assetClass(), anyCombo.lookupKey(),
            anyCombo.exchange(), anyCombo.product(), BASE);
        assertThat(ids).isNotEmpty();
    }

    private kr.fees.batch.ComboUniverse.Combo jdbcCombo() {
        var row = jdbc().queryForMap(
            "SELECT asset_class, lookup_key, exchange_code, product_code FROM fee_rule_candidate_index LIMIT 1");
        return new kr.fees.batch.ComboUniverse.Combo(
            kr.fees.domain.AssetClass.valueOf((String) row.get("asset_class")),
            kr.fees.domain.LookupKey.valueOf((String) row.get("lookup_key")),
            (String) row.get("exchange_code"),
            "*".equals(row.get("product_code")) ? null : (String) row.get("product_code"));
    }

    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;
    private org.springframework.jdbc.core.JdbcTemplate jdbc() { return jdbcTemplate; }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'kr.fees.persistence.RankingRepositoryTest'`
Expected: COMPILE FAIL — `RankingRepository`/`CandidateIndexRepository` 미존재

- [ ] **Step 3: 구현 — RankingRepository**

```java
package kr.fees.persistence;

import kr.fees.domain.FeeScheduleModel;
import kr.fees.domain.PolicyRanking;
import kr.fees.domain.RankedPolicy;
import kr.fees.domain.RuleModel;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 저장 순위 읽기 경로 (§10.4). 순위 계산은 승인 시점(RankIndexService) 한 곳 —
 * 배치·증분·화면·추적·미스경로는 여기서 저장 순위를 읽기만 한다.
 */
@Repository
public class RankingRepository {

    private final ScheduleRepository schedules;
    private final JdbcTemplate jdbc;

    public RankingRepository(ScheduleRepository schedules, JdbcTemplate jdbc) {
        this.schedules = schedules;
        this.jdbc = jdbc;
    }

    public Map<String, BigDecimal> storedRanks() {
        Map<String, BigDecimal> m = new LinkedHashMap<>();
        jdbc.query("SELECT rule_id, rank_value FROM fee_rule WHERE rank_value IS NOT NULL",
            rs -> { m.put(rs.getString(1), rs.getBigDecimal(2)); });
        return m;
    }

    /** 기존 PolicyRanking.build(active, schedMap, today) 호출을 이 한 줄로 대체한다. */
    public List<RankedPolicy> ranking(List<RuleModel> active, LocalDate today) {
        Map<String, FeeScheduleModel> schedMap = schedules.findAllAsMap();
        return PolicyRanking.fromStored(active, schedMap, storedRanks(), today);
    }
}
```

- [ ] **Step 4: 구현 — CandidateIndexRepository**

```java
package kr.fees.persistence;

import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

/** 조합별 후보 색인 조회 (§10.4). 순서는 저장(rank_position), 기간 멤버십은 읽기 시점 필터. */
@Repository
public class CandidateIndexRepository {

    private final JdbcTemplate jdbc;

    public CandidateIndexRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<String> candidates(AssetClass assetClass, LookupKey lookupKey,
                                   String exchange, String product, LocalDate today) {
        return jdbc.query("""
            SELECT rule_id FROM fee_rule_candidate_index
            WHERE asset_class = ? AND lookup_key = ? AND exchange_code = ? AND product_code = ?
              AND start_date <= ?
              AND (? <= end_date OR (rule_type = 'EVENT' AND benefit_kind = 'RELATIVE'))
            ORDER BY rank_position""",
            (rs, i) -> rs.getString(1),
            assetClass.name(), lookupKey.name(),
            exchange == null ? "*" : exchange,
            product == null ? "*" : product,
            today, today);
    }

    public boolean isEmpty() {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM fee_rule_candidate_index", Integer.class);
        return n == null || n == 0;
    }
}
```

- [ ] **Step 5: 통과 확인**

Run: `./gradlew test --tests 'kr.fees.persistence.RankingRepositoryTest'`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/kr/fees/persistence/RankingRepository.java \
        server/src/main/java/kr/fees/persistence/CandidateIndexRepository.java \
        server/src/test/java/kr/fees/persistence/RankingRepositoryTest.java
git commit -m "feat(persistence): 저장 순위 읽기 경로 — RankingRepository·CandidateIndexRepository

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 소비자 전환 — 배치·증분·추적·미스경로·우선순위 화면이 저장 순위를 읽는다

**Files:**
- Modify: `server/src/main/java/kr/fees/batch/BindingRebuilder.java:44-46` (+ 생성자·필드)
- Modify: `server/src/main/java/kr/fees/batch/IncrementalBinder.java:38-40` (+ 생성자·필드)
- Modify: `server/src/main/java/kr/fees/service/TraceService.java:53-54` (+ 생성자·필드)
- Modify: `server/src/main/java/kr/fees/service/LedgerLookupService.java:52-58` (+ 생성자·필드)
- Modify: `server/src/main/java/kr/fees/service/PriorityService.java:34-40` (`ranking()`만 — `top()`은 Task 7)
- Test: 기존 테스트 전체(무수정) — 의미론 불변 증명

**Interfaces:**
- Consumes: `RankingRepository.ranking(List<RuleModel> active, LocalDate today)` (Task 5).
- Produces: 다섯 소비자 모두 `PolicyRanking.build` 직접 호출 제거. `PolicyRanking.build`의 프로덕션 호출처는 `RankIndexService`(간접: RankKey)와 도메인 테스트만 남는다.

- [ ] **Step 1: BindingRebuilder 수정**

생성자에 `RankingRepository rankings` 주입 추가(필드 포함), 그리고:

```java
// 변경 전 (44-46행)
List<RuleModel> active = rules.findActive(baseDate);
Map<String, FeeScheduleModel> schedMap = schedules.findAllAsMap();
List<RankedPolicy> ranking = PolicyRanking.build(active, schedMap, baseDate);

// 변경 후
List<RuleModel> active = rules.findActive(baseDate);
List<RankedPolicy> ranking = rankings.ranking(active, baseDate);
```

`schedules` 필드·생성자 파라미터·`Map`/`FeeScheduleModel`/`PolicyRanking` import가 이 클래스에서 더 안 쓰이면 함께 제거.

- [ ] **Step 2: IncrementalBinder 수정 (동일 패턴, 38-40행)**

```java
// 변경 후
List<RuleModel> active = rules.findActive(baseDate);
List<RankedPolicy> ranking = rankings.ranking(active, baseDate);
```

`schedules`(ScheduleRepository) 필드가 다른 곳에서 안 쓰이면 제거.

- [ ] **Step 3: TraceService 수정 (53-54행)**

```java
// 변경 후
List<RankedPolicy> ranking = rankings.ranking(active, tradeDate);
```

- [ ] **Step 4: LedgerLookupService.baseWinner 수정 (52-58행)**

```java
private Optional<Winner> baseWinner(FeeKey key, LocalDate tradeDate) {
    List<RuleModel> baseRules = rules.findActive(tradeDate).stream()
        .filter(r -> r.type() == RuleType.BASE).toList();
    List<RankedPolicy> ranking = rankings.ranking(baseRules, tradeDate);
    return WinnerResolver.winnerFor(key, BASE_PROBE, List.of(), ranking, tradeDate);
}
```

- [ ] **Step 5: PriorityService.ranking() 수정 (34-40행; top()은 그대로 둔다)**

생성자에 `RankingRepository rankings` 주입 추가(필드 포함 — Task 7의 top()도 이 필드를 쓴다), 그리고:

```java
public List<Entry> ranking(AssetClass assetClass, LocalDate today) {
    List<RuleModel> active = rules.findActive(today).stream()
        .filter(r -> assetClass == null || r.scope().assetClass() == assetClass)
        .toList();
    return rankings.ranking(active, today).stream().map(PriorityService::toEntry).toList();
}
```

- [ ] **Step 6: 전체 테스트로 의미론 불변 증명**

Run: `./gradlew test`
Expected: 전체 PASS. 승인 경로를 우회해 ACTIVE 룰을 넣는 테스트(CrossCellBindingTest, DeltaAndIncrementalTest 등)는 fromStored의 fallback(WARN 로그)으로 통과한다 — 로그에 WARN이 보이는 것은 정상.

- [ ] **Step 7: Commit**

```bash
git add server/src/main/java/kr/fees/batch/BindingRebuilder.java \
        server/src/main/java/kr/fees/batch/IncrementalBinder.java \
        server/src/main/java/kr/fees/service/TraceService.java \
        server/src/main/java/kr/fees/service/LedgerLookupService.java \
        server/src/main/java/kr/fees/service/PriorityService.java
git commit -m "refactor(batch,service): 랭킹 소비자 5곳을 저장 순위 읽기 경로로 전환

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: PriorityService.top() — 후보 색인에서 고르기

**Files:**
- Modify: `server/src/main/java/kr/fees/service/PriorityService.java:42-55`
- Test: `server/src/test/java/kr/fees/service/PriorityTopIndexTest.java` (신규) + 기존 `kr.fees.api.PriorityApiTest` 무수정 통과

**Interfaces:**
- Consumes: `CandidateIndexRepository.candidates(...)`, `RankingRepository.storedRanks()`, `PolicyRanking.inRanking`, `ScopeMatcher.matches`, `RankKey.of`.
- Produces: `top()`이 색인 순서로 후보를 훑어 첫 매칭을 반환. **색인이 비어 있으면(미구축 콜드스타트) 기존 즉석 경로로 fallback** — 동작 보장.

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package kr.fees.service;

import kr.fees.batch.RankIndexService;
import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import kr.fees.persistence.PgIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class PriorityTopIndexTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired PriorityService priority;
    @Autowired RankIndexService rankIndex;

    @Test
    void 색인_구축_후_top이_색인_경로로_기존과_같은_답을_준다() {
        // 색인 없이(즉석 fallback) 얻은 답
        var before = priority.top(AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES,
            "CME", null, "ES", null, BASE);
        rankIndex.rebuildAll(BASE);
        // 색인 경로로 얻은 답 — 동일해야 한다
        var after = priority.top(AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES,
            "CME", null, "ES", null, BASE);
        assertThat(after.top()).isNotNull();
        assertThat(after.top().ruleId()).isEqualTo(before.top().ruleId());
        assertThat(after.top().rank()).isEqualByComparingTo(before.top().rank());
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'kr.fees.service.PriorityTopIndexTest'`
Expected: PASS일 수도 있음(둘 다 같은 답을 내므로). 이 테스트는 회귀 가드다 — 실패하면 색인 경로가 잘못된 것. 컴파일 실패라면 Step 3 먼저.

- [ ] **Step 3: top() 구현 교체**

`PriorityService` 생성자에 `CandidateIndexRepository candidateIndex`, `RankingRepository rankings` 주입 추가(Task 6에서 rankings는 이미 추가됨), 그리고:

```java
/** 조회키의 이론상 최저(자격 무시) — 후보 색인에서 순위순으로 고른다. 색인 미구축 시 즉석 경로 fallback. */
public TopResponse top(AssetClass assetClass, LookupKey lookupKey,
                       String exchange, String session, String product, String channel, LocalDate today) {
    FeeKey key = FeeKey.of(assetClass, exchange, lookupKey, session, channel, product);
    if (candidateIndex.isEmpty()) {
        return topByComputation(assetClass, key, today); // 콜드스타트 fallback
    }
    Map<String, RuleModel> active = rules.findActive(today).stream()
        .collect(java.util.stream.Collectors.toMap(RuleModel::id, r -> r));
    Map<String, FeeScheduleModel> schedMap = schedules.findAllAsMap();
    Map<String, BigDecimal> ranks = rankings.storedRanks();

    // 색인 조합 키: 주식형은 요청 exchange(없으면 '*'), 파생은 요청 exchange + 품목
    for (String id : candidateIndex.candidates(assetClass, lookupKey, exchange, product, today)) {
        RuleModel r = active.get(id);
        if (r == null) continue;
        if (!PolicyRanking.inRanking(r, today)) continue;
        if (!ScopeMatcher.matches(r.scope(), key)) continue; // 세션·채널 축 최종 판정
        FeeScheduleModel s = schedMap.get(r.scheduleId());
        if (s == null) continue;
        return new TopResponse(new Entry(r.id(), r.name(), r.type(), s.id(), s.name(),
            ranks.getOrDefault(id, RankKey.of(s)), r.scope()));
    }
    return new TopResponse(null);
}

private TopResponse topByComputation(AssetClass assetClass, FeeKey key, LocalDate today) {
    List<RuleModel> active = rules.findActive(today).stream()
        .filter(r -> r.scope().assetClass() == assetClass)
        .toList();
    return rankings.ranking(active, today).stream()
        .filter(p -> ScopeMatcher.matches(p.rule().scope(), key))
        .findFirst()
        .map(p -> new TopResponse(toEntry(p)))
        .orElse(new TopResponse(null));
}
```

주의: 주식형에서 호출자가 구체 거래소를 넘겼는데 색인에 그 거래소 조합이 없으면(어떤 룰도 그 거래소를 한정하지 않음) 후보 0건이 나온다. 이 경우 `'*'` 조합으로 한 번 더 조회하는 보정을 넣는다:

```java
List<String> ids = candidateIndex.candidates(assetClass, lookupKey, exchange, product, today);
if (ids.isEmpty() && exchange != null && !"*".equals(exchange) && !assetClass.isDerivative()) {
    ids = candidateIndex.candidates(assetClass, lookupKey, "*", product, today);
}
```

(위 for-루프를 이 `ids` 리스트 순회로 바꾼다.)

- [ ] **Step 4: 통과 확인 (신규 + 기존 API 테스트)**

Run: `./gradlew test --tests 'kr.fees.service.PriorityTopIndexTest' --tests 'kr.fees.api.PriorityApiTest'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/kr/fees/service/PriorityService.java \
        server/src/test/java/kr/fees/service/PriorityTopIndexTest.java
git commit -m "feat(service): PriorityService.top — 후보 색인에서 고르기(콜드스타트 fallback 포함)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: RuleService 승인·종료에 순위 확정 배선

**Files:**
- Modify: `server/src/main/java/kr/fees/service/RuleService.java:63-86` (+ 생성자·필드)
- Test: `server/src/test/java/kr/fees/service/RuleApprovalRankTest.java` (신규) + 기존 `kr.fees.api.WorkflowApiTest` 무수정 통과

**Interfaces:**
- Consumes: `RankIndexService.rebuildAll(LocalDate)` (Task 4).
- Produces: `approve()`/`expire()`가 상태 변경 → **순위 확정(rebuildAll)** → 배정판 증분(binder) 순서로, 전부 한 트랜잭션에서 수행. binder가 읽는 저장 순위에 방금 승인된 룰이 반드시 포함된다.

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package kr.fees.service;

import kr.fees.domain.*;
import kr.fees.persistence.PgIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class RuleApprovalRankTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired RuleService ruleService;
    @Autowired JdbcTemplate jdbc;

    private RuleService.CreatedRule draftDomesticStockEvent(double customerBp) {
        var scope = new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null);
        var rule = new RuleModel(null, "테스트 이벤트", RuleType.EVENT, RuleStatus.DRAFT, ApplyMode.AUTO_ENROLL,
            BASE, LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, null, scope, null, null);
        var schedule = new FeeScheduleModel(null, "테스트 요율표", List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE,
                BigDecimal.valueOf(customerBp), null, null, null)));
        return ruleService.createDraft(rule, schedule);
    }

    // 주의: approve()의 지배관계 검증이 시드의 국내주식 기준선과 구조가 달라 실패하면
    // (DominanceValidator 구조 비교 특성), 자산군을 OVERSEAS_DERIV·FLAT $0.10 픽스처로 바꿔
    // 기준선($2.50 FLAT)을 확실히 하회하게 할 것. 테스트 의도(승인→rank·색인 반영)는 동일하다.

    @Test
    void 승인하면_rank_value가_찍히고_색인에_등장한다() {
        var created = draftDomesticStockEvent(0.5);
        ruleService.submit(created.ruleId());
        ruleService.approve(created.ruleId(), BASE);

        BigDecimal rank = jdbc.queryForObject(
            "SELECT rank_value FROM fee_rule WHERE rule_id = ?", BigDecimal.class, created.ruleId());
        assertThat(rank).isEqualByComparingTo("0.5");

        Integer indexed = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index WHERE rule_id = ?", Integer.class, created.ruleId());
        assertThat(indexed).isGreaterThan(0); // 국내주식 조합들에 후보로 등장
    }

    @Test
    void 종료하면_색인에서_사라진다() {
        var created = draftDomesticStockEvent(0.5);
        ruleService.submit(created.ruleId());
        ruleService.approve(created.ruleId(), BASE);
        ruleService.expire(created.ruleId(), BASE);

        Integer indexed = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index WHERE rule_id = ?", Integer.class, created.ruleId());
        assertThat(indexed).isZero();
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'kr.fees.service.RuleApprovalRankTest'`
Expected: FAIL — `rank_value`가 NULL (승인 경로가 아직 rebuildAll을 안 부름)

- [ ] **Step 3: 구현 — RuleService 배선**

생성자에 `RankIndexService rankIndex` 주입 추가(필드 포함, import `kr.fees.batch.RankIndexService`), 그리고:

```java
@Transactional
public BatchResult approve(String ruleId, LocalDate baseDate) {
    RuleModel rule = rules.findById(ruleId).orElseThrow(() -> new IllegalArgumentException("룰 없음: " + ruleId));
    if (rule.status() != RuleStatus.PENDING) {
        throw new IllegalArgumentException("PENDING만 승인 가능(현재: " + rule.status() + ")");
    }
    ValidationReport report = validate(ruleId);
    if (!report.dominanceOk()) {
        throw new DominanceViolation(report);
    }
    rules.updateStatus(ruleId, RuleStatus.ACTIVE);
    rankIndex.rebuildAll(baseDate);              // 순위 확정 — 승인 시점 한 곳 (§10.4)
    return binder.onRuleApproved(ruleId, baseDate);
}

@Transactional
public BatchResult expire(String ruleId, LocalDate baseDate) {
    rules.updateStatus(ruleId, RuleStatus.EXPIRED);
    rankIndex.rebuildAll(baseDate);              // 종료 반영 — 색인에서 제거
    return binder.onRuleExpired(ruleId, baseDate);
}
```

- [ ] **Step 4: 통과 확인 (신규 + 워크플로우 회귀)**

Run: `./gradlew test --tests 'kr.fees.service.RuleApprovalRankTest' --tests 'kr.fees.api.WorkflowApiTest'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/kr/fees/service/RuleService.java \
        server/src/test/java/kr/fees/service/RuleApprovalRankTest.java
git commit -m "feat(service): 승인·종료 트랜잭션에서 순위 확정(rank_value·색인) 배선

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 기동 시 보정 — 시드·reseed의 직접 ACTIVE 삽입 커버

**Files:**
- Create: `server/src/main/java/kr/fees/batch/RankIndexBootstrap.java`
- Test: `server/src/test/java/kr/fees/batch/RankIndexBootstrapTest.java`

**Interfaces:**
- Consumes: `RankIndexService.rebuildAll`, `CandidateIndexRepository.isEmpty()`.
- Produces: `ApplicationRunner` — 기동 시 `rank_value` 누락 ACTIVE 룰이 있거나 색인이 비어 있으면 1회 `rebuildAll(LocalDate.now())`. (시드 SQL·reseed는 승인 경로를 우회해 ACTIVE로 삽입하므로 이 보정이 필요하다.)

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package kr.fees.batch;

import kr.fees.persistence.PgIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

class RankIndexBootstrapTest extends PgIntegrationTest {

    @Autowired RankIndexBootstrap bootstrap;
    @Autowired JdbcTemplate jdbc;

    @Test
    void 누락_상태에서_기동_보정이_순위와_색인을_채운다() throws Exception {
        // 강제로 누락 상태를 만든다
        jdbc.update("UPDATE fee_rule SET rank_value = NULL");
        jdbc.update("DELETE FROM fee_rule_candidate_index");

        bootstrap.run(new DefaultApplicationArguments());

        Integer missing = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule WHERE rule_status = 'ACTIVE' AND rank_value IS NULL", Integer.class);
        Integer indexed = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index", Integer.class);
        assertThat(missing).isZero();
        assertThat(indexed).isGreaterThan(0);
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'kr.fees.batch.RankIndexBootstrapTest'`
Expected: COMPILE FAIL — `RankIndexBootstrap` 미존재

- [ ] **Step 3: 구현**

```java
package kr.fees.batch;

import kr.fees.persistence.CandidateIndexRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;

/**
 * 기동 시 순위 사전 산정 보정. 시드·reseed 는 룰을 ACTIVE 로 직접 삽입(승인 경로 우회)하므로
 * rank_value 누락 또는 색인 공백이 있으면 1회 재적재한다. 운영 중 수작업 정정 후에는
 * POST /api/batch/rank-index/rebuild 로 같은 보정을 수동 실행할 수 있다.
 */
@Component
public class RankIndexBootstrap implements ApplicationRunner {

    private static final Logger LOG = LoggerFactory.getLogger(RankIndexBootstrap.class);

    private final RankIndexService rankIndex;
    private final CandidateIndexRepository candidateIndex;
    private final JdbcTemplate jdbc;

    public RankIndexBootstrap(RankIndexService rankIndex, CandidateIndexRepository candidateIndex, JdbcTemplate jdbc) {
        this.rankIndex = rankIndex;
        this.candidateIndex = candidateIndex;
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        Integer missing = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule WHERE rule_status = 'ACTIVE' AND rank_value IS NULL", Integer.class);
        boolean needs = (missing != null && missing > 0) || candidateIndex.isEmpty();
        if (!needs) return;
        var summary = rankIndex.rebuildAll(LocalDate.now());
        LOG.info("기동 순위 보정: rank_value {}건, 조합 {}개, 색인 {}행", 
            summary.rulesStamped(), summary.combos(), summary.indexRows());
    }
}
```

- [ ] **Step 4: 통과 확인**

Run: `./gradlew test --tests 'kr.fees.batch.RankIndexBootstrapTest'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/kr/fees/batch/RankIndexBootstrap.java \
        server/src/test/java/kr/fees/batch/RankIndexBootstrapTest.java
git commit -m "feat(batch): 기동 시 순위·색인 보정 — 시드 직접 삽입 커버

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: 운영 재적재 API + reseed 안내 + 전체 검증

**Files:**
- Modify: `server/src/main/java/kr/fees/api/BatchController.java`
- Modify: `docs/scripts/키움수수료_실데이터_reseed.sql` (말미 주석 1블록)
- Test: 기존 `kr.fees.api.ApiWebTest` 관례에 맞춘 스모크는 선택 — 최종 검증은 전체 스위트

**Interfaces:**
- Consumes: `RankIndexService.rebuildAll`, `RebuildSummary`.
- Produces: `POST /api/batch/rank-index/rebuild?baseDate=...` → `RebuildSummary` JSON.

- [ ] **Step 1: BatchController에 엔드포인트 추가**

생성자에 `RankIndexService rankIndex` 주입 추가(필드 포함), 그리고:

```java
/** 순위·후보 색인 수동 재적재 — reseed·수작업 정정 후 보정용. */
@PostMapping("/rank-index/rebuild")
public RankIndexService.RebuildSummary rebuildRankIndex(
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate baseDate) {
    return rankIndex.rebuildAll(baseDate != null ? baseDate : LocalDate.now());
}
```

import에 `kr.fees.batch.RankIndexService` 추가.

- [ ] **Step 2: reseed 스크립트 말미에 안내 주석 추가**

`docs/scripts/키움수수료_실데이터_reseed.sql` 파일 끝에:

```sql
-- ------------------------------------------------------------
-- 적용 후 순위 보정: 이 스크립트는 룰을 ACTIVE 로 직접 삽입하므로(승인 경로 우회)
-- rank_value·후보 색인이 비어 있다. 서버 재기동(기동 보정) 또는 아래 API 로 1회 재적재할 것.
--   POST /api/batch/rank-index/rebuild
-- ------------------------------------------------------------
```

- [ ] **Step 3: 전체 스위트 최종 검증**

Run: `cd /Users/yujin-an/dev/fees/server && ./gradlew test`
Expected: 전체 PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/main/java/kr/fees/api/BatchController.java \
        docs/scripts/키움수수료_실데이터_reseed.sql
git commit -m "feat(api): 순위·색인 수동 재적재 엔드포인트 + reseed 보정 안내

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 완료 기준 (Definition of Done)

1. `./gradlew test` 전체 PASS — 기존 테스트 무수정.
2. 룰 승인 트랜잭션이 `rank_value` + 후보 색인을 함께 커밋한다 (Task 8 테스트).
3. 배치·증분·추적·미스경로·우선순위 화면이 저장 순위를 읽는다 — 프로덕션 코드에서 `PolicyRanking.build` 직접 호출은 남지 않는다 (`grep -rn "PolicyRanking.build" server/src/main/java` 결과 0건).
4. 색인 없이도(콜드스타트) 모든 경로가 동작한다 — fallback 경로 + 기동 보정.
5. 등가성: 저장 랭킹 == 즉석 랭킹 (Task 5 동치성 테스트), 배정판 결과 불변 (기존 BindingRebuilderTest·E2eScenarioTest).

## 명시적 비범위 (YAGNI)

- 색인 부분 갱신("걸리는 조합만") — 전면 재생성으로 충분(MB 규모). 프로파일에서 문제 되면 후속.
- 집합 연산 대량 산출(§10.4 2단계) — 별도 플랜.
- 요율표 수정 API/가드 — 현재 수정 경로가 없어 불변이 성립. 수정 기능 도입 시 재적재 강제 필수(주석으로 남김).
- `fee_rule_candidate_index`의 이력화(누가 언제 어떤 순위였나) — 감사 요구 확정 후 후속.
