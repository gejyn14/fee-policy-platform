package kr.fees.batch;

import kr.fees.domain.LookupKey;
import kr.fees.domain.QualifyType;
import kr.fees.domain.RuleType;
import kr.fees.persistence.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class DeltaAndIncrementalTest extends PgIntegrationTest {

    private static final LocalDate BASE = LocalDate.of(2026, 7, 7);

    @Autowired BindingRebuilder rebuilder;
    @Autowired DeltaBatch deltaBatch;
    @Autowired IncrementalBinder binder;
    @Autowired BindingRepository bindings;
    @Autowired EnrollmentRepository enrollments;
    @Autowired HistoryRepository history;
    @Autowired JdbcTemplate jdbc;

    @Test
    void 협의_승인_증분이_해당_계좌_배정판에_협의행을_넣는다() {
        // 7022-3345-11 이 해외주식 협의(R-NEGO-OS) 신청 → 승인 → 증분
        long id = enrollments.insertRequest("7022-3345-11", "R-NEGO-OS", QualifyType.MET, null, "REQ-INC", "tester");
        enrollments.approveByRequestId("REQ-INC", BASE, BASE.plusYears(1), "approver");

        var result = binder.onNegoApproved("REQ-INC", BASE);
        assertThat(result.inserted()).isGreaterThan(0);

        var rows = bindings.findByAccount("7022-3345-11");
        assertThat(rows).anySatisfy(r -> {
            assertThat(r.lookupKey()).isEqualTo(LookupKey.STOCK);
            assertThat(r.sourceType()).isEqualTo(RuleType.NEGOTIATED);
            assertThat(r.sourceRuleId()).isEqualTo("R-NEGO-OS");
        });
        assertThat(history.findByAccount("7022-3345-11"))
            .anySatisfy(h -> assertThat(h.triggerSource()).isEqualTo("NEGO_APPROVED"));
    }

    @Test
    void 어제_만료한_우대행은_delta에서_기본으로_복귀() {
        // 6015-8890-42 국내주식에 어제(BASE-1) 만료하는 가짜 이벤트 배정판 행을 심는다.
        jdbc.update("""
            INSERT INTO fee_binding(account_id, asset_class, lookup_key, valid_from, valid_to,
                schedule_id, source_rule_id, source_type)
            VALUES ('6015-8890-42','DOMESTIC_STOCK','STOCK','2026-06-01', ?, 'SCH-DS-EVT','R-EVT-DS','EVENT')""",
            BASE.minusDays(1));
        assertThat(bindings.findByAccount("6015-8890-42")).hasSize(1);

        deltaBatch.run(BASE);

        // R-EVT-DS 는 PENDING(비활성)이라 승자 아님 → 만료행 제거, 국내주식은 전부 기본 → 빈 배정판
        assertThat(bindings.findByAccount("6015-8890-42")).isEmpty();
        assertThat(history.findByAccount("6015-8890-42"))
            .anySatisfy(h -> assertThat(h.triggerSource()).isEqualTo("DELTA"));
    }

    @Test
    void 증분은_전체재산출과_동일_결과_멱등() {
        rebuilder.fullRebuild(BASE);
        var before = bindings.findByAccount("8041-2237-01").size();
        // 같은 계좌를 증분으로 다시 돌려도 변화 없어야 함
        var r = binder.onEnrollment("8041-2237-01", BASE);
        assertThat(r.inserted()).isZero();
        assertThat(r.updated()).isZero();
        assertThat(bindings.findByAccount("8041-2237-01")).hasSize(before);
    }
}
