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
