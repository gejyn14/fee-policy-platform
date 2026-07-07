package kr.fees.batch;

import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import kr.fees.domain.RuleType;
import kr.fees.persistence.BindingRepository;
import kr.fees.persistence.BindingRow;
import kr.fees.persistence.PgIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class BindingRebuilderTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired BindingRebuilder rebuilder;
    @Autowired BindingRepository bindings;

    private List<BindingRow> rebuildAndGet(String accountId) {
        rebuilder.fullRebuild(BASE);
        return bindings.findByAccount(accountId);
    }

    @Test
    void 데모계좌_배정판이_기술설계서_6_2와_일치_우대분만() {
        var rows = rebuildAndGet("8041-2237-01");
        // B안: 우대(EVENT/NEGOTIATED)만 저장. 기본 승자(ES 옵션, 해외주식 STOCK)는 행 없음.
        assertThat(rows).allSatisfy(r -> assertThat(r.sourceType()).isIn(RuleType.EVENT, RuleType.NEGOTIATED));

        // ES·GC 선물 = 협의 T2
        assertThat(rows).filteredOn(r -> r.lookupKey() == LookupKey.FUTURES)
            .allSatisfy(r -> {
                assertThat(r.sourceRuleId()).isEqualTo("R-NEGO-02");
                assertThat(r.sourceType()).isEqualTo(RuleType.NEGOTIATED);
                assertThat(r.validTo()).isEqualTo(LocalDate.of(2026, 12, 31)); // enrollment 기간 전파
            })
            .extracting(BindingRow::productCode).containsExactlyInAnyOrder("ES", "GC");

        // ES 옵션 = 기본 → 배정판에 없음
        assertThat(rows).noneSatisfy(r -> assertThat(r.lookupKey()).isEqualTo(LookupKey.OPTIONS));

        // 해외 ETF = 이벤트
        assertThat(rows).filteredOn(r -> r.lookupKey() == LookupKey.ETF)
            .singleElement()
            .satisfies(r -> {
                assertThat(r.sourceType()).isEqualTo(RuleType.EVENT);
                assertThat(r.sourceRuleId()).isEqualTo("R-EVT-12");
            });

        // 해외주식 STOCK = 기본 → 배정판에 없음
        assertThat(rows).noneSatisfy(r -> assertThat(r.lookupKey()).isEqualTo(LookupKey.STOCK));
    }

    @Test
    void 순수계좌는_배정판이_비어있다() {
        var rows = rebuildAndGet("6015-8890-42"); // 국내주식만, 우대 없음 → 전부 기본
        assertThat(rows).isEmpty();
    }

    @Test
    void 재실행은_멱등_변경분_없음() {
        rebuilder.fullRebuild(BASE);
        var second = rebuilder.fullRebuild(BASE);
        assertThat(second.inserted()).isZero();
        assertThat(second.updated()).isZero();
        assertThat(second.deleted()).isZero();
        assertThat(second.unchanged()).isGreaterThan(0);
    }
}
