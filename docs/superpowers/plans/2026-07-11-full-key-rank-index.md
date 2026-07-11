# 후보 색인 완전 키화 (6축: 세션·채널 편입) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수수료를 가를 수 있는 **계좌 무관 스코프 키 전부**(자산군·조회구분·거래소·품목·**세션·채널** = 6축)를 승인 시점에 사전 랭크해 두어, 계좌 산출(2차전)의 계좌당 작업을 "키 조회 + 자격 게이트"로 줄인다. 계좌 hot loop에서 ScopeMatcher 스캔과 셀 축 재수집이 사라진다. fee_binding 산출 결과는 불변.

**Architecture:** ① 셀 유니버스의 계좌 무관 부분을 `CellUniverse.universe()`로 추출(6축 FeeKey 목록 — 색인 조합과 계좌 셀이 **같은 열거**를 공유). ② 6축 셀 키는 곧 `FeeKey`이므로 후보 판정은 **`ScopeMatcher.matches` 그 자체** — `ComboUniverse`는 삭제된다(로직 한 벌 강화). ③ 새 `CandidateMap`(셀→순위순 후보 목록)을 배치 실행당 1회, 계좌 무관으로 빌드해 색인 적재(RankIndexService)와 계좌 산출(BindingWriter)이 **같은 빌더를 공유**한다. ④ `fee_rule_candidate_index`는 V6에서 6축 키 + `tie_order`/`specificity` 컬럼으로 재생성(파생 테이블이라 이관 없음). ⑤ 점 조회(`top()`)는 축마다 `IN (?, '*')` 프로브 + 저장된 4키 정렬로 조합 횡단 조회 — 기존 '*'-재조회 특례가 사라진다. ⑥ 배치의 계좌 루프는 `winnerAmong`(게이트만 걷는 새 진입점)으로 승자를 뽑는다.

**Tech Stack:** Spring Boot 3 (JdbcTemplate, Flyway), PostgreSQL 16, JUnit 5 + AssertJ + Testcontainers(Podman).

## Global Constraints

- **fee_binding 산출 결과 불변**이 완료 조건: 배정판 관련 기존 테스트(`BindingRebuilderTest`, `CrossCellBindingTest`, `DeltaAndIncrementalTest`, `E2eScenarioTest`, `WinnerResolverTest`, `EligibilityGateTest`, `ScopeMatcherTest`, `CellUniverseTest`, API 테스트 전부)는 **무수정 통과**해야 한다.
- 색인 계층 테스트는 6축 API에 맞춰 갱신이 **허용**된다(이 4개만): `ComboUniverseTest`(삭제), `RankIndexServiceTest`, `RankingRepositoryTest`, `PriorityTopIndexTest`.
- 후보 판정의 단일 출처는 `ScopeMatcher.matches` — 별도 isCandidate류 판정 함수를 새로 만들지 않는다. 순위 산식의 단일 출처는 `RankKey.java`(변경 없음).
- 멤버십(기간·상대형 이벤트 예외)은 계속 **읽기 시점 필터**: 색인에는 기간 필터를 적용하지 않고 순서만 저장한다.
- `fee_rule_candidate_index`는 파생 테이블 — V6은 DROP+CREATE로 재생성하고 데이터 이관 없음(기동 보정·승인 재적재가 채움).
- 배치(2차전)는 색인 **테이블을 읽지 않는다** — 같은 저장 순위값(`fee_rule.rank_value`)에서 `CandidateMap`을 실행당 1회 메모리 빌드한다(직접 ACTIVE 삽입 테스트 픽스처·콜드스타트와 호환). 테이블의 소비자는 점 조회(top)와 운영 가시성. 수십억 규모의 SQL 집합 연산 경로(§10.4 2단계)는 비범위.
- 테스트 실행: `cd /Users/yujin-an/dev/fees/server && ./gradlew test --tests '<클래스>'`. 통합 테스트는 `PgIntegrationTest` 상속.
- 커밋 메시지는 저장소 관례(한국어, `feat(...)`/`refactor(...)`/`test(...)`) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러. 브랜치: `main`에서 새 브랜치 `feature/full-key-rank-index` 생성 후 진행.

### 규모 추정 (색인 성장 — 여전히 정책-바운드)

축 값은 **활성 룰이 실제로 한정한 값 ∪ '*'**만 전개된다(전체 데카르트 아님). reseed 기준: 국내주식·주식 = 거래소 3 × 세션 1 × 채널 7 ≈ 21조합, 파생은 품목×{선물,옵션}×세션(≤3)×채널(≤3). 전체 수천 행·수백 KB — 계좌 수와 무관.

---

### Task 1: CellUniverse 리팩터 — 계좌 무관 `universe()` 추출

**Files:**
- Modify: `server/src/main/java/kr/fees/batch/CellUniverse.java`
- Test: `server/src/test/java/kr/fees/batch/CellUniverseSharedTest.java` (신규; 기존 `CellUniverseTest.java`는 무수정)

**Interfaces:**
- Consumes: 기존 `cellsFor(String, Set<AssetClass>, List<ProductModel>, List<RuleModel>)` 본문.
- Produces: `public static List<FeeKey> universe(List<ProductModel> products, List<RuleModel> activeRules)` — 전 자산군의 계좌 무관 6축 셀 목록. `cellsFor`는 시그니처 불변, universe 필터로 재구현.

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package kr.fees.batch;

import kr.fees.domain.*;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class CellUniverseSharedTest {

    private final List<ProductModel> products = List.of(
        new ProductModel(AssetClass.OVERSEAS_DERIV, "CME", "ES", "E-mini", "USD", List.of("REGULAR")));

    private RuleModel rule(String id, RuleScope scope) {
        return new RuleModel(id, id, RuleType.EVENT, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), BenefitKind.CALENDAR, null, "S", scope, null, null);
    }

    @Test
    void universe는_cellsFor와_같은_열거의_계좌무관_상위집합이다() {
        var night = rule("R-N", new RuleScope(AssetClass.OVERSEAS_DERIV, null, Set.of("NIGHT"), null, null, Set.of(), null));
        var mts = rule("R-M", new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), Set.of("MTS")));
        var rules = List.of(night, mts);

        var uni = CellUniverse.universe(products, rules);
        var derivCells = CellUniverse.cellsFor("A", Set.of(AssetClass.OVERSEAS_DERIV), products, rules);
        var stockCells = CellUniverse.cellsFor("A", Set.of(AssetClass.DOMESTIC_STOCK), products, rules);

        // 계좌 전개는 universe 를 자산군으로 거른 것과 정확히 일치한다
        assertThat(uni.stream().filter(k -> k.assetClass() == AssetClass.OVERSEAS_DERIV).toList())
            .containsExactlyInAnyOrderElementsOf(derivCells);
        assertThat(uni.stream().filter(k -> k.assetClass() == AssetClass.DOMESTIC_STOCK).toList())
            .containsExactlyInAnyOrderElementsOf(stockCells);
        // 세션·채널 축이 유니버스에도 갈라져 있다 (야간 셀, MTS 셀 존재)
        assertThat(uni).anyMatch(k -> "NIGHT".equals(k.session()));
        assertThat(uni).anyMatch(k -> "MTS".equals(k.channel()));
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'kr.fees.batch.CellUniverseSharedTest'`
Expected: COMPILE FAIL — `universe` 미존재

- [ ] **Step 3: 구현 — cellsFor 본문을 universe로 이동**

`CellUniverse.java`의 `cellsFor`를 다음 둘로 교체(나머지 메서드·주석은 유지, 클래스 javadoc에 "universe = 색인·계좌 전개 공용 열거" 한 줄 추가):

```java
    /**
     * 전 자산군의 계좌 무관 셀 유니버스 — 6축 색인(RankIndexService)과 계좌 전개(cellsFor)가
     * 같은 열거를 공유한다. 계좌가 기여하는 것은 개설 상품군 pruning 뿐이다.
     */
    public static List<FeeKey> universe(List<ProductModel> products, List<RuleModel> activeRules) {
        Set<FeeKey> cells = new LinkedHashSet<>();
        for (AssetClass ac : AssetClass.values()) {
            boolean deriv = ac.isDerivative();
            for (FeeKey base : baseCells(ac, products)) {
                Set<String> exchanges = new LinkedHashSet<>(List.of(base.exchange()));
                Set<String> sessions = new LinkedHashSet<>(List.of(ALL));
                Set<String> channels = new LinkedHashSet<>(List.of(ALL));
                for (RuleModel r : activeRules) {
                    RuleScope s = r.scope();
                    if (!matchesFamily(s, base, deriv)) continue;
                    if (!deriv && s.exchanges() != null) exchanges.addAll(s.exchanges());
                    if (s.sessions() != null) sessions.addAll(s.sessions());
                    if (s.channels() != null) channels.addAll(s.channels());
                }
                for (String ex : exchanges) {
                    for (String se : sessions) {
                        for (String ch : channels) {
                            cells.add(new FeeKey(ac, ex, base.lookupKey(), se, ch, base.product()));
                        }
                    }
                }
            }
        }
        return new ArrayList<>(cells);
    }

    public static List<FeeKey> cellsFor(String accountId, Set<AssetClass> openedGroups,
                                        List<ProductModel> products, List<RuleModel> activeRules) {
        List<FeeKey> out = new ArrayList<>();
        for (FeeKey k : universe(products, activeRules)) {
            if (openedGroups.contains(k.assetClass())) out.add(k);
        }
        return out;
    }
```

주의: 기존 `cellsFor` 본문의 내부 루프를 **그대로** universe로 옮긴다(축 수집·데카르트 로직 무변경). 셀 내용은 동일하고 순회 순서만 `AssetClass.values()` 순으로 바뀔 수 있는데, `BindingWriter`가 insert를 키 정렬하므로 결과 불변.

- [ ] **Step 4: 통과 확인 (기존 CellUniverseTest 무수정 포함)**

Run: `./gradlew test --tests 'kr.fees.batch.CellUniverseSharedTest' --tests 'kr.fees.batch.CellUniverseTest'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/kr/fees/batch/CellUniverse.java \
        server/src/test/java/kr/fees/batch/CellUniverseSharedTest.java
git commit -m "refactor(batch): CellUniverse.universe — 색인·계좌 전개 공용 계좌무관 열거 추출

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: CandidateMap + WinnerResolver.winnerAmong

**Files:**
- Create: `server/src/main/java/kr/fees/batch/CandidateMap.java`
- Modify: `server/src/main/java/kr/fees/domain/WinnerResolver.java` (메서드 1개 추가, 기존 무변경)
- Test: `server/src/test/java/kr/fees/batch/CandidateMapTest.java`

**Interfaces:**
- Consumes: `CellUniverse.universe` (Task 1), `ScopeMatcher.matches`, `RankedPolicy`, `EligibilityGate.passes`, `WinnerResolver.toWinner`(private — winnerAmong는 같은 클래스 내부라 재사용 가능).
- Produces:
  - `CandidateMap.build(List<FeeKey> universe, List<RankedPolicy> ranking)` → `CandidateMap`. **전제: ranking은 이미 comparator 정렬 상태**(fromStored/RankIndexService 둘 다 그러함 — javadoc에 명시).
  - `candidateMap.cells()` → `Set<FeeKey>` (universe 순서 유지), `candidateMap.candidates(FeeKey)` → `List<RankedPolicy>` (순위순, 없으면 빈 목록).
  - `WinnerResolver.winnerAmong(List<RankedPolicy> candidates, AccountModel, List<Enrollment>, LocalDate)` → `Optional<Winner>` — 범위 매칭이 끝난 후보 목록에서 **자격 게이트만** 걸어 첫 통과를 뽑는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package kr.fees.batch;

import kr.fees.domain.*;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class CandidateMapTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 7, 11);

    private RuleModel rule(String id, RuleType type, RuleScope scope) {
        return new RuleModel(id, id, type, RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL,
            LocalDate.of(2026, 1, 1), LocalDate.of(9999, 12, 31), BenefitKind.CALENDAR, null, "S-" + id, scope, null, null);
    }

    private FeeScheduleModel schedule(String id, double bp) {
        return new FeeScheduleModel(id, id, List.of(
            new FeeComponent("자사", Kind.OWN, Payer.CUSTOMER, RateType.RATE, BigDecimal.valueOf(bp), null, null, null)));
    }

    private List<RankedPolicy> ranking(RuleModel... rules) {
        return java.util.Arrays.stream(rules)
            .map(r -> new RankedPolicy(r, schedule(r.scheduleId(), 1.0), RankKey.of(schedule(r.scheduleId(), 1.0))))
            .sorted(PolicyRanking.comparator())
            .toList();
    }

    @Test
    void 셀마다_ScopeMatcher_통과_후보만_순위순으로_담긴다() {
        var all = rule("R-ALL", RuleType.BASE,
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null));
        var mts = rule("R-MTS", RuleType.EVENT,
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), Set.of("MTS")));
        var ranking = ranking(all, mts);
        var universe = CellUniverse.universe(List.of(), List.of(all, mts));

        var map = CandidateMap.build(universe, ranking);

        FeeKey star = FeeKey.of(AssetClass.DOMESTIC_STOCK, "*", LookupKey.STOCK, "*", "*", null);
        FeeKey mtsCell = FeeKey.of(AssetClass.DOMESTIC_STOCK, "*", LookupKey.STOCK, "*", "MTS", null);
        assertThat(map.candidates(star)).extracting(p -> p.rule().id()).containsExactly("R-ALL");
        assertThat(map.candidates(mtsCell)).extracting(p -> p.rule().id()).containsExactly("R-MTS", "R-ALL");
        assertThat(map.cells()).containsExactlyInAnyOrderElementsOf(universe);
    }

    @Test
    void winnerAmong은_winnerFor와_같은_승자를_준다() {
        var all = rule("R-ALL", RuleType.BASE,
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null));
        var mts = rule("R-MTS", RuleType.EVENT,
            new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), Set.of("MTS")));
        var ranking = ranking(all, mts);
        var acct = new AccountModel("A-1", "홍길동", "지점", false, BigDecimal.ZERO, BigDecimal.ZERO);
        FeeKey mtsCell = FeeKey.of(AssetClass.DOMESTIC_STOCK, "*", LookupKey.STOCK, "*", "MTS", null);

        var viaFor = WinnerResolver.winnerFor(mtsCell, acct, List.of(), ranking, TODAY);
        var candidates = CandidateMap.build(
            CellUniverse.universe(List.of(), List.of(all, mts)), ranking).candidates(mtsCell);
        var viaAmong = WinnerResolver.winnerAmong(candidates, acct, List.of(), TODAY);

        assertThat(viaAmong).isPresent();
        assertThat(viaAmong.get().ruleId()).isEqualTo(viaFor.get().ruleId());
        assertThat(viaAmong.get().sourceType()).isEqualTo(viaFor.get().sourceType());
    }
}
```

주의: `AccountModel` 생성자 필드는 `LedgerLookupService.BASE_PROBE`(`new AccountModel("_BASE_", "_", "_", false, ZERO, ZERO)`)와 같은 형태다. 컴파일이 다르면 `AccountModel.java`를 읽고 최소 조정하되 단언은 유지한다.

- [ ] **Step 2: 실패 확인**

Run: `./gradlew test --tests 'kr.fees.batch.CandidateMapTest'`
Expected: COMPILE FAIL — `CandidateMap`/`winnerAmong` 미존재

- [ ] **Step 3: 구현 — CandidateMap**

```java
package kr.fees.batch;

import kr.fees.domain.FeeKey;
import kr.fees.domain.RankedPolicy;
import kr.fees.domain.ScopeMatcher;

import java.util.*;

/**
 * 셀(6축 FeeKey) → 순위순 후보 목록. 배치 실행당 1회, 계좌 무관으로 빌드한다.
 * 색인 적재(RankIndexService)와 계좌 산출(BindingWriter)이 같은 빌더를 공유한다 — 로직 한 벌.
 * 후보 판정은 ScopeMatcher.matches 그 자체다(6축 셀 키가 곧 FeeKey이므로).
 * 전제: ranking 은 이미 PolicyRanking.comparator() 정렬 상태다(fromStored·RankIndexService 공통).
 */
public final class CandidateMap {

    private final Map<FeeKey, List<RankedPolicy>> byCell;

    private CandidateMap(Map<FeeKey, List<RankedPolicy>> byCell) {
        this.byCell = byCell;
    }

    public static CandidateMap build(List<FeeKey> universe, List<RankedPolicy> ranking) {
        Map<FeeKey, List<RankedPolicy>> m = new LinkedHashMap<>();
        for (FeeKey cell : universe) {
            List<RankedPolicy> cands = new ArrayList<>();
            for (RankedPolicy p : ranking) {
                if (ScopeMatcher.matches(p.rule().scope(), cell)) cands.add(p);
            }
            m.put(cell, cands);
        }
        return new CandidateMap(m);
    }

    public Set<FeeKey> cells() {
        return byCell.keySet();
    }

    public List<RankedPolicy> candidates(FeeKey cell) {
        return byCell.getOrDefault(cell, List.of());
    }
}
```

- [ ] **Step 4: 구현 — WinnerResolver.winnerAmong (기존 winnerFor 아래에 추가, 기존 코드 무변경)**

```java
    /**
     * 사전 필터된 후보 목록(범위 매칭 완료 — CandidateMap/색인 경로)에서 자격 게이트만 걸어
     * 첫 통과를 뽑는다. winnerFor 와 동일 의미론에서 ScopeMatcher 단계만 앞당겨진 형태.
     */
    public static Optional<Winner> winnerAmong(List<RankedPolicy> candidates, AccountModel acct,
                                               List<Enrollment> enrollments, LocalDate today) {
        for (RankedPolicy p : candidates) {
            if (!EligibilityGate.passes(p.rule(), acct, enrollments, today)) continue;
            return Optional.of(toWinner(p.rule(), acct, enrollments));
        }
        return Optional.empty();
    }
```

- [ ] **Step 5: 통과 확인 (도메인 회귀 포함)**

Run: `./gradlew test --tests 'kr.fees.batch.CandidateMapTest' --tests 'kr.fees.domain.WinnerResolverTest'`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/kr/fees/batch/CandidateMap.java \
        server/src/main/java/kr/fees/domain/WinnerResolver.java \
        server/src/test/java/kr/fees/batch/CandidateMapTest.java
git commit -m "feat(batch,domain): CandidateMap + winnerAmong — 셀별 사전 후보 지도와 게이트 전용 승자 확정

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 색인 계층 6축 전환 — V6 + 쓰기 + 점 조회 (원자적 전환)

이 태스크는 이 플랜에서 가장 크다. V6 스키마·RankIndexService·CandidateIndexRepository·PriorityService.top이 서로 컴파일/제약(NOT NULL) 의존이라 **한 커밋으로 전환**해야 중간 상태에서도 스위트가 깨지지 않는다.

**Files:**
- Create: `server/src/main/resources/db/migration/V6__rank_index_full_key.sql`
- Modify: `server/src/main/java/kr/fees/batch/RankIndexService.java`
- Modify: `server/src/main/java/kr/fees/persistence/CandidateIndexRepository.java`
- Modify: `server/src/main/java/kr/fees/service/PriorityService.java` (top()의 후보 조회부만)
- Delete: `server/src/main/java/kr/fees/batch/ComboUniverse.java`, `server/src/test/java/kr/fees/batch/ComboUniverseTest.java`
- Test(갱신 허용): `server/src/test/java/kr/fees/batch/RankIndexServiceTest.java`, `server/src/test/java/kr/fees/persistence/RankingRepositoryTest.java`, `server/src/test/java/kr/fees/service/PriorityTopIndexTest.java`

**Interfaces:**
- Consumes: `CellUniverse.universe` (Task 1), `CandidateMap.build` (Task 2), `RuleType.tieOrder()`, `RuleScope.specificity()`.
- Produces:
  - V6 테이블: 6축 키(+`session_code`,`channel_code` DEFAULT '*') + `tie_order int NOT NULL`, `specificity int NOT NULL` 컬럼, PK `(asset_class, lookup_key, exchange_code, product_code, session_code, channel_code, rank_position)`.
  - `CandidateIndexRepository.candidates(AssetClass, LookupKey, String exchange, String product, String session, String channel, LocalDate)` — 축마다 `IN (?, '*')` 프로브, `ORDER BY rank_value, tie_order, specificity DESC, rule_id`, rule_id 중복 제거(LinkedHashSet).
  - `PriorityService.top`: 7-인자 candidates 호출로 교체, 주식형 '*'-재조회 블록 삭제(프로브가 '*'를 포함하므로 불필요), 나머지(ScopeMatcher 걷기·compute fallback) 유지.

- [ ] **Step 1: V6 마이그레이션 작성**

```sql
-- V6: 후보 색인 완전 키화 — 세션·채널 축 편입 (§10.4 확장).
-- 수수료를 가르는 계좌 무관 스코프 키 6축을 모두 승인 시점에 사전 랭크한다.
-- 계좌 산출(2차전)은 키 조회 + 자격 게이트만 남는다.
-- 파생 테이블이므로 데이터 이관 없이 재생성 — 기동 보정(RankIndexBootstrap)·승인 재적재가 채운다.
-- tie_order/specificity 저장: 조합 횡단 점 조회(top)가 SQL만으로 4키 정렬을 재현하기 위함.

DROP TABLE fee_rule_candidate_index;

CREATE TABLE fee_rule_candidate_index (
    asset_class   text NOT NULL,
    lookup_key    text NOT NULL,
    exchange_code text NOT NULL DEFAULT '*',
    product_code  text NOT NULL DEFAULT '*',
    session_code  text NOT NULL DEFAULT '*',
    channel_code  text NOT NULL DEFAULT '*',
    rank_position int  NOT NULL,
    rule_id       text NOT NULL REFERENCES fee_rule(rule_id),
    rank_value    numeric(18,4) NOT NULL,
    tie_order     int  NOT NULL,
    specificity   int  NOT NULL,
    rule_type     text NOT NULL,
    start_date    date NOT NULL,
    end_date      date NOT NULL,
    benefit_kind  text NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_class, lookup_key, exchange_code, product_code,
                 session_code, channel_code, rank_position)
);

CREATE INDEX ix_candidate_rule ON fee_rule_candidate_index(rule_id);
```

- [ ] **Step 2: RankIndexService — universe × CandidateMap으로 6축 적재**

`INSERT_SQL` 상수와 ② 블록을 다음으로 교체(① rank_value 스탬프 블록은 무변경). import에서 `ComboUniverse` 제거, `kr.fees.domain.FeeKey` 사용. 클래스 javadoc의 "조합별" 서술에 "6축(세션·채널 포함)" 반영:

```java
    private static final String INSERT_SQL = """
        INSERT INTO fee_rule_candidate_index(asset_class, lookup_key, exchange_code, product_code,
            session_code, channel_code, rank_position, rule_id, rank_value, tie_order, specificity,
            rule_type, start_date, end_date, benefit_kind)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""";
```

```java
        // ② 6축 셀 유니버스 × 저장 순위 → 후보 지도 — 계좌 산출(BindingWriter)과 같은 빌더 공유(로직 한 벌)
        jdbc.update("DELETE FROM fee_rule_candidate_index");
        List<RankedPolicy> allRanked = preRanked.stream()
            .sorted(PolicyRanking.comparator())
            .toList();

        List<FeeKey> universe = CellUniverse.universe(products.findAll(), active);
        CandidateMap map = CandidateMap.build(universe, allRanked);
        List<Object[]> insertArgs = new ArrayList<>();
        for (FeeKey cell : map.cells()) {
            int pos = 0;
            for (RankedPolicy p : map.candidates(cell)) {
                insertArgs.add(new Object[]{
                    cell.assetClass().name(), cell.lookupKey().name(), cell.exchange(),
                    cell.product() == null ? "*" : cell.product(),
                    cell.session(), cell.channel(),
                    ++pos, p.rule().id(), p.rank(),
                    p.rule().type().tieOrder(), p.rule().scope().specificity(),
                    p.rule().type().name(), p.rule().startDate(), p.rule().endDate(),
                    p.rule().benefitKind().name()
                });
            }
        }
        if (!insertArgs.isEmpty()) {
            jdbc.batchUpdate(INSERT_SQL, insertArgs);
        }
        return new RebuildSummary(rankArgs.size(), universe.size(), insertArgs.size());
```

- [ ] **Step 3: ComboUniverse + ComboUniverseTest 삭제**

`git rm server/src/main/java/kr/fees/batch/ComboUniverse.java server/src/test/java/kr/fees/batch/ComboUniverseTest.java`
(그 의미론은 이제 `ScopeMatcher.matches`(기존 `ScopeMatcherTest`가 커버)와 `CellUniverse.universe`(Task 1 테스트)로 흡수된다.)

- [ ] **Step 4: CandidateIndexRepository — 6축 IN-프로브 점 조회**

`candidates`를 다음으로 교체(`isEmpty()` 무변경):

```java
    /**
     * 점 조회(top)용: 구체 조회키가 걸릴 수 있는 조합('*' 포함)을 전부 모아,
     * 저장된 4키 정렬(rank_value, tie_order, specificity DESC, rule_id)로 돌려준다.
     * 조합 횡단이라 rank_position 은 쓰지 않는다. 같은 룰이 여러 조합에 실릴 수 있어 중복 제거.
     * 기간 멤버십은 읽기 시점 필터(PolicyRanking.inRanking 과 동일 의미론).
     */
    public List<String> candidates(AssetClass assetClass, LookupKey lookupKey, String exchange,
                                   String product, String session, String channel, LocalDate today) {
        List<String> ids = jdbc.query("""
            SELECT rule_id FROM fee_rule_candidate_index
            WHERE asset_class = ? AND lookup_key = ?
              AND exchange_code IN (?, '*') AND product_code IN (?, '*')
              AND session_code IN (?, '*') AND channel_code IN (?, '*')
              AND (
                (rule_type = 'EVENT' AND benefit_kind = 'RELATIVE')
                OR (start_date <= ? AND ? <= end_date)
              )
            ORDER BY rank_value, tie_order, specificity DESC, rule_id""",
            (rs, i) -> rs.getString(1),
            assetClass.name(), lookupKey.name(),
            exchange == null ? "*" : exchange,
            product == null ? "*" : product,
            session == null ? "*" : session,
            channel == null ? "*" : channel,
            today, today);
        return new ArrayList<>(new LinkedHashSet<>(ids));
    }
```

import에 `java.util.ArrayList`, `java.util.LinkedHashSet` 추가.

- [ ] **Step 5: PriorityService.top — 7-인자 호출 + '*'-재조회 삭제**

top() 안의 후보 조회부(두 줄짜리 조회 + if-재조회 블록)를 다음 한 줄로 교체하고, 그 위의 주석("색인 조합 키: …")도 "6축 프로브('*' 포함)라 재조회 특례 불필요"로 갱신. 나머지(콜드스타트 분기, ScopeMatcher 걷기, compute fallback)는 무변경:

```java
        List<String> ids = candidateIndex.candidates(assetClass, lookupKey, exchange, product, session, channel, today);
```

- [ ] **Step 6: 색인 계층 테스트 갱신**

`RankIndexServiceTest`: 기존 4개 테스트의 SQL에서 그룹 컬럼을 6축으로 확장(`GROUP BY 1,2,3,4` → `GROUP BY 1,2,3,4,5,6`; ORDER BY에 `session_code, channel_code` 추가). 그리고 6축 신규 테스트 2개 추가:

```java
    @Test
    void 세션_한정_룰은_자기_세션_조합에만_실린다() {
        // 세션 NIGHT 한정 ACTIVE 룰을 직접 삽입(승인 우회) 후 재적재
        var scope = new kr.fees.domain.RuleScope(kr.fees.domain.AssetClass.DOMESTIC_STOCK,
            null, java.util.Set.of("NIGHT"), null, null, java.util.Set.of(), null);
        ruleRepository.insert(new kr.fees.domain.RuleModel("R-TEST-NIGHT", "야간 테스트",
            kr.fees.domain.RuleType.EVENT, kr.fees.domain.RuleStatus.ACTIVE,
            kr.fees.domain.ApplyMode.AUTO_ENROLL, BASE, BASE.plusMonths(6),
            kr.fees.domain.BenefitKind.CALENDAR, null, existingScheduleId(), scope, null, null));
        rankIndex.rebuildAll(BASE);

        Integer wrong = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index WHERE rule_id = 'R-TEST-NIGHT' AND session_code <> 'NIGHT'",
            Integer.class);
        Integer right = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index WHERE rule_id = 'R-TEST-NIGHT' AND session_code = 'NIGHT'",
            Integer.class);
        assertThat(wrong).isZero();
        assertThat(right).isGreaterThan(0);
    }

    @Test
    void 별표_세션_조합은_세션_한정_룰을_담지_않는다() {
        insertNightRule();          // 첫 테스트와 공유하는 픽스처 헬퍼
        rankIndex.rebuildAll(BASE);
        Integer leaked = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule_candidate_index WHERE rule_id = 'R-TEST-NIGHT' AND session_code = '*'",
            Integer.class);
        assertThat(leaked).isZero();
    }

    private String existingScheduleId() {
        return jdbc.queryForObject("SELECT schedule_id FROM fee_schedule LIMIT 1", String.class);
    }

    private void insertNightRule() {
        var scope = new kr.fees.domain.RuleScope(kr.fees.domain.AssetClass.DOMESTIC_STOCK,
            null, java.util.Set.of("NIGHT"), null, null, java.util.Set.of(), null);
        ruleRepository.insert(new kr.fees.domain.RuleModel("R-TEST-NIGHT", "야간 테스트",
            kr.fees.domain.RuleType.EVENT, kr.fees.domain.RuleStatus.ACTIVE,
            kr.fees.domain.ApplyMode.AUTO_ENROLL, BASE, BASE.plusMonths(6),
            kr.fees.domain.BenefitKind.CALENDAR, null, existingScheduleId(), scope, null, null));
    }
```

(첫 테스트의 인라인 삽입도 `insertNightRule()` 호출로 정리한다. `ruleRepository`는 `@Autowired RuleRepository ruleRepository;` 필드로 추가.)

`RankingRepositoryTest`: `jdbcCombo()` 헬퍼와 그 사용처를 다음으로 교체(`ComboUniverse` 참조 제거, 단언 의미 유지 — 비어있지 않음):

```java
    @Test
    void 색인_후보_조회는_기간을_필터하고_순위순으로_돌려준다() {
        rankIndex.rebuildAll(BASE);
        assertThat(candidateIndex.isEmpty()).isFalse();
        var row = jdbcTemplate.queryForMap("""
            SELECT asset_class, lookup_key, exchange_code, product_code, session_code, channel_code
            FROM fee_rule_candidate_index LIMIT 1""");
        List<String> ids = candidateIndex.candidates(
            kr.fees.domain.AssetClass.valueOf((String) row.get("asset_class")),
            kr.fees.domain.LookupKey.valueOf((String) row.get("lookup_key")),
            "*".equals(row.get("exchange_code")) ? null : (String) row.get("exchange_code"),
            "*".equals(row.get("product_code")) ? null : (String) row.get("product_code"),
            "*".equals(row.get("session_code")) ? null : (String) row.get("session_code"),
            "*".equals(row.get("channel_code")) ? null : (String) row.get("channel_code"),
            BASE);
        assertThat(ids).isNotEmpty();
    }
```

`PriorityTopIndexTest`: Fix-2 가드의 `candidateIndex.candidates(...)` 호출을 7-인자(session=null, channel=null)로 교체. 나머지 테스트는 `priority.top` 시그니처가 원래 세션·채널을 받으므로 무수정.

- [ ] **Step 7: 통과 확인**

Run: `./gradlew test --tests 'kr.fees.batch.RankIndexServiceTest' --tests 'kr.fees.persistence.RankingRepositoryTest' --tests 'kr.fees.service.PriorityTopIndexTest' --tests 'kr.fees.api.PriorityApiTest' --tests 'kr.fees.batch.RankIndexBootstrapTest' --tests 'kr.fees.persistence.MigrationTest'`
Expected: 전부 PASS (bootstrap 테스트의 sentinel 삽입 SQL이 새 NOT NULL 컬럼 때문에 실패하면, 그 테스트의 INSERT에 `session_code, channel_code, tie_order, specificity` 값을 추가하는 최소 수정 허용 — 단언 의미 불변)

- [ ] **Step 8: Commit**

```bash
git add -A server/src/main/resources/db/migration/V6__rank_index_full_key.sql \
        server/src/main/java/kr/fees/batch/RankIndexService.java \
        server/src/main/java/kr/fees/persistence/CandidateIndexRepository.java \
        server/src/main/java/kr/fees/service/PriorityService.java \
        server/src/main/java/kr/fees/batch/ComboUniverse.java \
        server/src/test/java/kr/fees/batch/ComboUniverseTest.java \
        server/src/test/java/kr/fees/batch/RankIndexServiceTest.java \
        server/src/test/java/kr/fees/persistence/RankingRepositoryTest.java \
        server/src/test/java/kr/fees/service/PriorityTopIndexTest.java
git commit -m "feat(schema,batch,service): 후보 색인 6축 완전 키화 — 세션·채널 사전 랭크 + IN-프로브 점 조회

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 2차전 재배선 — 계좌 루프에서 ScopeMatcher·셀 전개 제거

**Files:**
- Modify: `server/src/main/java/kr/fees/batch/BindingWriter.java`
- Modify: `server/src/main/java/kr/fees/batch/BindingRebuilder.java`
- Modify: `server/src/main/java/kr/fees/batch/IncrementalBinder.java`
- Test: 기존 배정판 테스트 전체(무수정) — 등가성 게이트

**Interfaces:**
- Consumes: `CandidateMap` (Task 2), `WinnerResolver.winnerAmong` (Task 2), `CellUniverse.universe` (Task 1).
- Produces: `BindingWriter.rebuildAccount(AccountModel, List<Enrollment>, Set<AssetClass> opened, CandidateMap candidates, LocalDate, String trigger)` — `List<ProductModel>`, `List<RuleModel>`, `List<RankedPolicy>` 파라미터가 사라진다. 호출자는 실행당 1회 CandidateMap을 빌드해 넘긴다.

- [ ] **Step 1: BindingWriter 수정**

`rebuildAccount` 시그니처와 셀 루프를 교체(diff 대조·이력 로직 무변경):

```java
    /** 한 계좌의 배정판을 기대값과 대조해 반영한다. candidates = 실행당 1회 빌드된 셀별 후보 지도. */
    public BatchResult rebuildAccount(AccountModel acct, List<Enrollment> enr, Set<AssetClass> opened,
                                      CandidateMap candidates, LocalDate baseDate, String trigger) {
        Map<String, BindingRow> expected = new LinkedHashMap<>();
        for (FeeKey cell : candidates.cells()) {
            if (!opened.contains(cell.assetClass())) continue;   // 계좌 pruning — 유일한 계좌 의존
            Optional<Winner> w = WinnerResolver.winnerAmong(candidates.candidates(cell), acct, enr, baseDate);
            if (w.isEmpty() || w.get().sourceType() == RuleType.BASE) continue;  // 기본은 미저장
            if (w.get().validFrom() == null) continue;
            BindingRow row = toRow(acct.id(), cell, w.get());
            expected.put(row.key(), row);
        }
        // (이하 current 대조·diff·이력·batchInsert 로직 그대로)
```

- [ ] **Step 2: BindingRebuilder 수정 — 실행당 1회 빌드**

fullRebuild의 준비부와 호출부를 교체:

```java
        List<RuleModel> active = rules.findActive(baseDate);
        List<RankedPolicy> ranking = rankings.ranking(active, baseDate);
        CandidateMap candidates = CandidateMap.build(
            CellUniverse.universe(products.findAll(), active), ranking);

        BatchResult total = BatchResult.zero();
        for (AccountModel acct : accounts.findAll()) {  // findAll 은 account_id 정렬
            var opened = accounts.openedGroups(acct.id());
            var enr = enrollments.findByAccount(acct.id());
            total = total.plus(writer.rebuildAccount(acct, enr, opened, candidates, baseDate, "DAILY_REBUILD"));
        }
```

(`products` 필드는 universe 빌드용으로 유지. `allProducts` 지역변수·미사용 import 정리.)

- [ ] **Step 3: IncrementalBinder 수정 — 동일 패턴**

rebuildAccounts의 준비부·호출부를 같은 형태로 교체:

```java
        List<RuleModel> active = rules.findActive(baseDate);
        List<RankedPolicy> ranking = rankings.ranking(active, baseDate);
        CandidateMap candidates = CandidateMap.build(
            CellUniverse.universe(products.findAll(), active), ranking);

        BatchResult total = BatchResult.zero();
        for (String id : new LinkedHashSet<>(accountIds)) {
            var acct = accounts.findById(id).orElse(null);
            if (acct == null) continue;
            var opened = accounts.openedGroups(id);
            var enr = enrollments.findByAccount(id);
            total = total.plus(writer.rebuildAccount(acct, enr, opened, candidates, baseDate, trigger));
        }
```

- [ ] **Step 4: 등가성 게이트 — 전체 스위트 무수정 통과**

Run: `./gradlew test`
Expected: 전부 PASS. 특히 `BindingRebuilderTest`·`CrossCellBindingTest`·`DeltaAndIncrementalTest`·`E2eScenarioTest`가 **무수정**으로 통과해야 한다 — winnerAmong(candidates) 경로가 winnerFor(ScopeMatcher) 경로와 배정판 결과 동일함의 증명. 하나라도 다르면 CandidateMap/universe 열거가 cellsFor와 어긋난 것이므로 여기서 멈추고 원인 규명(수정 대상은 프로덕션 코드, 테스트가 아님).

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/kr/fees/batch/BindingWriter.java \
        server/src/main/java/kr/fees/batch/BindingRebuilder.java \
        server/src/main/java/kr/fees/batch/IncrementalBinder.java
git commit -m "refactor(batch): 계좌 산출을 CandidateMap 키 조회 + 게이트로 — 계좌 루프에서 범위 매칭 제거

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 최종 게이트 + 산출물 정리

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-full-key-rank-index.md` (완료 체크)
- 저장소 밖(커밋 없음): `~/.agent/diagrams/policy-ranking-anatomy.html`, `~/.agent/diagrams/fee-policy-winner-selection.html`

**Interfaces:** 없음(검증·문서 태스크).

- [ ] **Step 1: 삭제·잔존 확인**

Run: `cd /Users/yujin-an/dev/fees/server && grep -rn "ComboUniverse" src | wc -l`
Expected: `0`

Run: `grep -rn "PolicyRanking.build" src/main/java | grep -v "//" | wc -l`
Expected: `0` (프로덕션 직접 호출 없음 유지)

- [ ] **Step 2: 전체 스위트 최종 실행**

Run: `./gradlew test`
Expected: 전부 PASS.

- [ ] **Step 3: HTML 페이지 반영 (저장소 밖 — 커밋 없음)**

`policy-ranking-anatomy.html`의 콜아웃 「**채널·세션은 왜 색인 키에 없나?**」를 다음 내용으로 교체:

> **채널·세션도 이제 색인 키다 (6축 완전 키).** 처음 구현은 4축(자산군·조회구분·거래소·품목)이었고 채널·세션은 2차전 ScopeMatcher가 갈랐다. 지금은 수수료를 가를 수 있는 계좌 무관 키 전부를 승인 시점에 사전 랭크한다 — 그래서 ARS 기본(채널 ARS)과 온라인 기본(HTS·MTS·API)은 이제 **다른 색인 그룹**에 산다. 2차전에 남는 계좌당 작업은 키 조회 + 자격 게이트뿐이며, 이것이 대규모 배치에서 계산량을 줄이는 핵심이다. 색인 크기는 여전히 정책-바운드(활성 룰이 한정한 값만 전개)로 수백 KB 수준.

같은 페이지의 단일 테이블 예시(「사실 이건 한 테이블이다」)에 `session_code`·`channel_code` 컬럼을 추가하고(국내주식 예시는 세션 전부 `*`, 채널은 `*`·HTS·MTS·API·ARS·센터·반대매매로 갈라짐 — 대표 행 몇 개만), 고정 컬럼 주석도 갱신한다. `fee-policy-winner-selection.html`의 「구현 현황 한 줄」 콜아웃에 "이후 6축 완전 키로 확장(세션·채널 편입)" 한 문장을 덧붙인다.

- [ ] **Step 4: Commit (플랜 체크박스 갱신분)**

```bash
git add docs/superpowers/plans/2026-07-11-full-key-rank-index.md
git commit -m "docs: 6축 색인 플랜 완료 체크

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 완료 기준 (Definition of Done)

1. `./gradlew test` 전체 PASS — 배정판·도메인·E2E·API 테스트 **무수정**(색인 계층 4개 테스트만 갱신).
2. `fee_rule_candidate_index`가 6축 키 — 세션·채널 한정 룰이 자기 축 조합에만 사전 랭크됨(신규 테스트로 증명).
3. 계좌 산출 hot loop에 ScopeMatcher 호출·셀 축 수집이 없다: 계좌당 작업 = 개설 상품군 필터 + 셀별 게이트 걷기. 범위 매칭은 실행당 1회(CandidateMap 빌드)로 이동.
4. `ComboUniverse` 삭제 — 후보 판정의 단일 출처는 `ScopeMatcher.matches`.
5. `top()`은 6축 IN-프로브로 조회하며 '*'-재조회 특례가 없다. 콜드스타트 compute fallback 유지.
6. 색인 행 수는 정책-바운드(수천 행·수백 KB) — 계좌 수와 무관.

## 명시적 비범위 (YAGNI)

- SQL 집합 연산 대량 산출(§10.4 2단계) — CandidateMap은 그 전 단계다. 배치가 색인 **테이블**을 직접 읽는 전환도 그때 함께.
- 색인 부분 갱신("걸리는 조합만") — 전면 재생성 유지.
- `TraceService`·`LedgerLookupService.baseWinner` 경로 변경 — 진단·미스 경로는 기존 flat 랭킹 걷기 유지(각각 전 후보 표시가 목적 / BASE 룰 소수라 이득 없음).
- `fee_binding` 스키마·조회 SQL 변경 없음(이미 6축 + IN-프로브).
- 성능 계측 하네스 — 구조상 이득이 자명(계좌×룰 ScopeMatcher 행렬 제거). 실측은 대량 시드가 생길 때.
