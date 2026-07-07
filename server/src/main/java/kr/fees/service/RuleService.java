package kr.fees.service;

import kr.fees.batch.BatchResult;
import kr.fees.batch.IncrementalBinder;
import kr.fees.domain.*;
import kr.fees.persistence.RuleRepository;
import kr.fees.persistence.ScheduleRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/** 룰 워크플로우 — 기안 → 검증(지배관계·역마진) → 승인/반려/종료. 승인 시 배정판 증분. */
@Service
public class RuleService {

    private static final Execution PROBE = new Execution(BigDecimal.valueOf(100_000), 10);

    private final RuleRepository rules;
    private final ScheduleRepository schedules;
    private final IncrementalBinder binder;

    public RuleService(RuleRepository rules, ScheduleRepository schedules, IncrementalBinder binder) {
        this.rules = rules;
        this.schedules = schedules;
        this.binder = binder;
    }

    public record ValidationReport(boolean dominanceOk, DominanceValidator.Failure dominanceFailure,
                                   boolean reverseMarginWarning) {}

    public ValidationReport validate(String ruleId) {
        RuleModel rule = rules.findById(ruleId).orElseThrow(() -> new IllegalArgumentException("룰 없음: " + ruleId));
        var schedMap = schedules.findAllAsMap();
        FeeScheduleModel candidate = schedMap.get(rule.scheduleId());
        if (candidate == null) throw new IllegalArgumentException("요율표 없음: " + rule.scheduleId());

        boolean reverse = DominanceValidator.reverseMargin(candidate, PROBE);

        if (rule.type() == RuleType.BASE) {
            return new ValidationReport(true, null, reverse); // 기본은 비교 대상 없음
        }
        Optional<FeeScheduleModel> base = activeBaseSchedule(rule.scope().assetClass(), rule.startDate(), schedMap);
        if (base.isEmpty()) {
            return new ValidationReport(true, null, reverse); // 기준선 없으면 통과
        }
        boolean ok = DominanceValidator.dominates(candidate, base.get());
        var failure = ok ? null : DominanceValidator.explainFailure(candidate, base.get()).orElse(null);
        return new ValidationReport(ok, failure, reverse);
    }

    /** 상신 — 기안(DRAFT) → 승인대기(PENDING). */
    @Transactional
    public void submit(String ruleId) {
        RuleModel r = rules.findById(ruleId).orElseThrow(() -> new IllegalArgumentException("룰 없음: " + ruleId));
        if (r.status() != RuleStatus.DRAFT) throw new IllegalArgumentException("DRAFT만 상신 가능(현재: " + r.status() + ")");
        rules.updateStatus(ruleId, RuleStatus.PENDING);
    }

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
        return binder.onRuleApproved(ruleId, baseDate);
    }

    @Transactional
    public void reject(String ruleId) {
        rules.updateStatus(ruleId, RuleStatus.REJECTED);
    }

    @Transactional
    public BatchResult expire(String ruleId, LocalDate baseDate) {
        rules.updateStatus(ruleId, RuleStatus.EXPIRED);
        return binder.onRuleExpired(ruleId, baseDate);
    }

    public void createDraft(RuleModel rule, FeeScheduleModel schedule) {
        if (schedule != null && schedules.findById(schedule.id()).isEmpty()) {
            schedules.insert(schedule);
        }
        RuleModel draft = new RuleModel(rule.id(), rule.name(), rule.type(), RuleStatus.DRAFT, rule.applyMode(),
            rule.startDate(), rule.endDate(), rule.benefitKind(), rule.benefitMonths(), rule.scheduleId(),
            rule.scope(), rule.condition(), rule.targetAccountIds());
        rules.insert(draft);
    }

    private Optional<FeeScheduleModel> activeBaseSchedule(AssetClass ac, LocalDate date,
                                                          java.util.Map<String, FeeScheduleModel> schedMap) {
        return rules.findActive(date).stream()
            .filter(r -> r.type() == RuleType.BASE && r.scope().assetClass() == ac)
            .map(r -> schedMap.get(r.scheduleId()))
            .filter(java.util.Objects::nonNull)
            .findFirst();
    }

    /** 지배관계 위반 승인 시도 — 컨트롤러가 400 으로 변환. */
    public static class DominanceViolation extends RuntimeException {
        private final transient ValidationReport report;
        public DominanceViolation(ValidationReport report) {
            super("우대 요율표가 기준선을 하회하지 않습니다(지배관계 위반)");
            this.report = report;
        }
        public ValidationReport report() {
            return report;
        }
    }
}
