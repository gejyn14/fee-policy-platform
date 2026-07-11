package kr.fees.service;

import kr.fees.batch.RankIndexService;
import kr.fees.domain.*;
import kr.fees.persistence.CandidateIndexRepository;
import kr.fees.persistence.PgIntegrationTest;
import kr.fees.persistence.RuleRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class PriorityTopIndexTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired PriorityService priority;
    @Autowired RankIndexService rankIndex;
    @Autowired RuleRepository ruleRepository;
    @Autowired CandidateIndexRepository candidateIndex;

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

    /**
     * Fix-1 회귀: 파생은 색인에 품목='*' 조합이 없다(ComboUniverse 가 구체 품목만 전개).
     * product 생략(컨트롤러 기본값 "*" → 서비스에는 null)으로 조회하면 색인 경로는 무승자로
     * 끝나야 하고, top() 은 그 경우 topByComputation 으로 fallback 해 null 을 반환하면 안 된다.
     * 색인이 비어 있을 때(콜드스타트)도 동일한 topByComputation 경로를 타므로, 재구축 전후
     * 답이 같아야 한다는 것이 가장 견고한 단언이다.
     */
    @Test
    void 파생_품목_생략시_색인_무승자여도_compute_fallback_으로_null이_아니다() {
        var before = priority.top(AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES,
            "CME", null, null, null, BASE);
        assertThat(before.top()).isNotNull(); // 콜드스타트 경로(topByComputation) 확인

        rankIndex.rebuildAll(BASE);
        var after = priority.top(AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES,
            "CME", null, null, null, BASE);

        assertThat(after.top()).isNotNull(); // Fix-1 이전에는 여기서 null
        assertThat(after.top().ruleId()).isEqualTo(before.top().ruleId());
    }

    /**
     * Fix-2 회귀: PolicyRanking.inRanking 은 EVENT+RELATIVE 룰을 기간(시작/종료일) 무관하게
     * 편입시킨다. candidates() SQL 이 동일 의미론을 갖는지 직접 검증 — 승인 경로를 우회해
     * ACTIVE 상태로 미래 시작일 RELATIVE 이벤트를 삽입하고(RuleRepository.insert 는 전달받은
     * RuleModel 의 status 를 그대로 저장하므로 워크플로우 없이 시드 가능), rebuildAll 로
     * 색인을 스탬프한 뒤 candidates() 결과에 포함되는지 확인한다.
     */
    @Test
    void 미래_시작일_RELATIVE_이벤트도_후보_색인에_포함된다() {
        LocalDate futureStart = BASE.plusMonths(1);
        var scope = new RuleScope(AssetClass.DOMESTIC_STOCK, null, null, null, null, Set.of(), null);
        var rule = new RuleModel("R-TEST-REL-FUTURE", "미래시작 상대형 이벤트(테스트)", RuleType.EVENT,
            RuleStatus.ACTIVE, ApplyMode.AUTO_ENROLL, futureStart, futureStart.plusYears(1),
            BenefitKind.RELATIVE, null, "SCH-DS-EVT", scope, null, null);
        ruleRepository.insert(rule);

        rankIndex.rebuildAll(BASE);

        List<String> ids = candidateIndex.candidates(AssetClass.DOMESTIC_STOCK, LookupKey.STOCK, "*", "*", BASE);
        assertThat(ids).contains("R-TEST-REL-FUTURE");
    }
}
