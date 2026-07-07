package kr.fees.persistence;

import kr.fees.domain.Enrollment;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

class SeedTest extends PgIntegrationTest {

    @Autowired AccountRepository accounts;
    @Autowired RuleRepository rules;
    @Autowired ScheduleRepository schedules;
    @Autowired EnrollmentRepository enrollments;

    @Test
    void 시드_계좌와_룰이_로드된다() {
        assertThat(accounts.findAll()).hasSize(4);
        assertThat(schedules.findAllAsMap()).containsKeys("SCH-OS-BASE", "SCH-OD-NEGO-T2", "SCH-OD-NEGO-T3");
        assertThat(rules.findAll()).extracting("id")
            .contains("R-BASE-01", "R-EVT-12", "R-NEGO-02", "R-NEGO-03", "R-NEGO-OS", "R-EVT-DS");
    }

    @Test
    void 데모계좌_8041은_협의T2와_ETF이벤트_부여를_가진다() {
        assertThat(enrollments.findByAccount("8041-2237-01"))
            .extracting(Enrollment::ruleId).containsExactlyInAnyOrder("R-NEGO-02", "R-EVT-12");
    }

    @Test
    void 순수계좌_6015는_부여가_없다() {
        assertThat(enrollments.findByAccount("6015-8890-42")).isEmpty();
    }
}
