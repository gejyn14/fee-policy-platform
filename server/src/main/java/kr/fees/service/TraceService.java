package kr.fees.service;

import kr.fees.domain.*;
import kr.fees.persistence.AccountRepository;
import kr.fees.persistence.EnrollmentRepository;
import kr.fees.persistence.RankingRepository;
import kr.fees.persistence.RuleRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 수수료 결정 추적 (FeeTrace 화면용). 도메인(PolicyRanking·ScopeMatcher·EligibilityGate)만 재사용.
 * 해당 자산군 활성 룰을 랭킹순으로 나열하고 각 룰의 범위·게이트 통과 여부와 탈락 사유를 붙인다.
 */
@Service
public class TraceService {

    private final RuleRepository rules;
    private final RankingRepository rankings;
    private final AccountRepository accounts;
    private final EnrollmentRepository enrollments;
    private final LedgerLookupService ledger;

    public TraceService(RuleRepository rules, RankingRepository rankings, AccountRepository accounts,
                        EnrollmentRepository enrollments, LedgerLookupService ledger) {
        this.rules = rules;
        this.rankings = rankings;
        this.accounts = accounts;
        this.enrollments = enrollments;
        this.ledger = ledger;
    }

    public record Candidate(String ruleId, String ruleName, RuleType ruleType, String scheduleId,
                            BigDecimal rank, boolean scopeMatch, boolean gatePass, String gateNote, boolean winner) {}

    public record TraceResult(List<Candidate> candidates, boolean bindingHit,
                              LedgerLookupService.LookupOutcome applied) {}

    public TraceResult trace(String accountId, AssetClass assetClass, LookupKey lookupKey,
                             String exchange, String session, String product, String channel, LocalDate tradeDate) {
        AccountModel acct = accounts.findById(accountId)
            .orElseThrow(() -> new IllegalArgumentException("계좌 없음: " + accountId));
        var enr = enrollments.findByAccount(accountId);
        FeeKey key = FeeKey.of(assetClass, exchange, lookupKey, session, channel, product);

        List<RuleModel> active = rules.findActive(tradeDate).stream()
            .filter(r -> r.scope().assetClass() == assetClass).toList();
        List<RankedPolicy> ranking = rankings.ranking(active, tradeDate);

        List<Candidate> candidates = new ArrayList<>();
        boolean winnerFound = false;
        for (RankedPolicy p : ranking) {
            RuleModel r = p.rule();
            boolean scope = ScopeMatcher.matches(r.scope(), key);
            boolean gate = scope && EligibilityGate.passes(r, acct, enr, tradeDate);
            boolean isWinner = gate && !winnerFound;
            if (isWinner) winnerFound = true;
            candidates.add(new Candidate(r.id(), r.name(), r.type(), r.scheduleId(), p.rank(),
                scope, gate, gateNote(r, acct, enr, key, scope, gate, tradeDate), isWinner));
        }

        var applied = ledger.lookup(accountId, assetClass, lookupKey, exchange, session, product, channel, tradeDate)
            .orElse(null);
        boolean bindingHit = applied != null && !applied.fallbackToBase();
        return new TraceResult(candidates, bindingHit, applied);
    }

    private String gateNote(RuleModel r, AccountModel acct, List<Enrollment> enr, FeeKey key,
                            boolean scope, boolean gate, LocalDate today) {
        if (!scope) return "범위 불일치";
        if (gate) return null;
        return switch (r.type()) {
            case BASE -> "—";
            case NEGOTIATED -> "협의 부여 없음/기간 밖";
            case EVENT -> !EligibilityGate.isTarget(r, acct, enr) ? "대상 아님" : "기간 밖";
        };
    }
}
