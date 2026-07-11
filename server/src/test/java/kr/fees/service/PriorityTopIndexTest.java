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
