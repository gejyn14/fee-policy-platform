package kr.fees;

import kr.fees.batch.BindingRebuilder;
import kr.fees.batch.DeltaBatch;
import kr.fees.domain.*;
import kr.fees.persistence.*;
import kr.fees.service.LedgerLookupService;
import kr.fees.service.NegoService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 스펙 §10 시나리오를 한 흐름으로 검증:
 * 시드 → 전체 재산출 → §6.2 배정판 확인 → 협의 신청·승인 증분 → 원장 조회(히트/미스→기본).
 */
class E2eScenarioTest extends PgIntegrationTest {

    private static final LocalDate D = LocalDate.of(2026, 7, 7);

    @Autowired BindingRebuilder rebuilder;
    @Autowired DeltaBatch deltaBatch;
    @Autowired NegoService nego;
    @Autowired LedgerLookupService ledger;
    @Autowired BindingRepository bindings;

    @Test
    void 전체_흐름() {
        // 1) 전체 재산출 → 데모계좌 배정판이 §6.2와 일치(우대분만)
        rebuilder.fullRebuild(D);
        var demo = bindings.findByAccount("8041-2237-01");
        assertThat(demo).isNotEmpty()
            .allSatisfy(r -> assertThat(r.sourceType()).isIn(RuleType.EVENT, RuleType.NEGOTIATED));
        assertThat(demo).filteredOn(r -> r.lookupKey() == LookupKey.FUTURES)
            .allSatisfy(r -> assertThat(r.sourceRuleId()).isEqualTo("R-NEGO-02"));

        // 2) 원장 조회 — 선물 셀 히트(협의), 옵션 셀 미스→기본
        var futures = ledger.lookup("8041-2237-01", AssetClass.OVERSEAS_DERIV, LookupKey.FUTURES,
            "CME", "REGULAR", "ES", "MTS", D).orElseThrow();
        assertThat(futures.sourceType()).isEqualTo(RuleType.NEGOTIATED);
        assertThat(futures.fallbackToBase()).isFalse();

        var options = ledger.lookup("8041-2237-01", AssetClass.OVERSEAS_DERIV, LookupKey.OPTIONS,
            "CME", "REGULAR", "ES", "MTS", D).orElseThrow();
        assertThat(options.sourceType()).isEqualTo(RuleType.BASE);
        assertThat(options.fallbackToBase()).isTrue();

        // 3) 협의 신청→승인 → 다른 계좌 배정판 증분
        var req = nego.createRequests(List.of("7022-3345-11"), "R-NEGO-OS", null, "tester");
        assertThat(req.perAccount().get(0).met()).isTrue();
        nego.approve(req.requestId(), D, "approver");
        assertThat(bindings.findByAccount("7022-3345-11"))
            .anySatisfy(r -> assertThat(r.sourceType()).isEqualTo(RuleType.NEGOTIATED));

        // 4) 승인 후 원장 조회 — 해외주식 협의 히트
        var stock = ledger.lookup("7022-3345-11", AssetClass.OVERSEAS_STOCK, LookupKey.STOCK,
            "*", "REGULAR", "*", "MTS", D).orElseThrow();
        assertThat(stock.sourceType()).isEqualTo(RuleType.NEGOTIATED);

        // 5) delta 배치가 오류 없이 수행됨
        deltaBatch.run(D);
    }
}
