package kr.fees.batch;

import kr.fees.domain.*;
import kr.fees.persistence.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.*;

/**
 * 수시 증분 (기술설계서 v1.5 §10.2). 룰·협의·이벤트 이벤트 발생 시 영향 계좌만 재산출.
 * 전체 재산출과 동일한 승자확정(BindingWriter)을 좁은 범위에 적용 — 로직 한 벌.
 */
@Service
public class IncrementalBinder {

    private final RuleRepository rules;
    private final RankingRepository rankings;
    private final AccountRepository accounts;
    private final ProductRepository products;
    private final EnrollmentRepository enrollments;
    private final BindingWriter writer;

    public IncrementalBinder(RuleRepository rules, RankingRepository rankings, AccountRepository accounts,
                             ProductRepository products, EnrollmentRepository enrollments, BindingWriter writer) {
        this.rules = rules;
        this.rankings = rankings;
        this.accounts = accounts;
        this.products = products;
        this.enrollments = enrollments;
        this.writer = writer;
    }

    /** 여러 계좌를 같은 트리거로 재산출 — delta 배치와 각 on* 트리거가 공유. */
    @Transactional
    public BatchResult rebuildAccounts(Collection<String> accountIds, LocalDate baseDate, String trigger) {
        List<RuleModel> active = rules.findActive(baseDate);
        List<RankedPolicy> ranking = rankings.ranking(active, baseDate);
        List<ProductModel> allProducts = products.findAll();

        BatchResult total = BatchResult.zero();
        for (String id : new LinkedHashSet<>(accountIds)) {
            var acct = accounts.findById(id).orElse(null);
            if (acct == null) continue;
            var opened = accounts.openedGroups(id);
            var enr = enrollments.findByAccount(id);
            total = total.plus(writer.rebuildAccount(acct, enr, opened, allProducts, active, ranking, baseDate, trigger));
        }
        return total;
    }

    public BatchResult onRuleApproved(String ruleId, LocalDate baseDate) {
        return rebuildAccounts(accountsForRule(ruleId), baseDate, "RULE_APPROVED");
    }

    public BatchResult onRuleExpired(String ruleId, LocalDate baseDate) {
        return rebuildAccounts(accountsForRule(ruleId), baseDate, "RULE_EXPIRED");
    }

    public BatchResult onNegoApproved(String requestId, LocalDate baseDate) {
        return rebuildAccounts(accountIdsOfRequest(requestId), baseDate, "NEGO_APPROVED");
    }

    public BatchResult onNegoExtended(Collection<String> accountIds, LocalDate baseDate) {
        return rebuildAccounts(accountIds, baseDate, "NEGO_EXTENDED");
    }

    public BatchResult onEnrollment(String accountId, LocalDate baseDate) {
        return rebuildAccounts(List.of(accountId), baseDate, "ENROLLMENT");
    }

    public BatchResult onDormantReturn(String accountId, LocalDate baseDate) {
        return rebuildAccounts(List.of(accountId), baseDate, "DORMANT_RETURN");
    }

    /** 룰 scope 자산군을 개설한 계좌들. */
    private List<String> accountsForRule(String ruleId) {
        return rules.findById(ruleId)
            .map(r -> accounts.accountIdsByOpenedGroup(r.scope().assetClass()))
            .orElse(List.of());
    }

    private List<String> accountIdsOfRequest(String requestId) {
        return enrollments.findByRequestId(requestId).stream().map(Enrollment::accountId).distinct().toList();
    }
}
