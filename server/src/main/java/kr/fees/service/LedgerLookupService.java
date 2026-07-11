package kr.fees.service;

import kr.fees.domain.*;
import kr.fees.persistence.BindingRepository;
import kr.fees.persistence.RankingRepository;
import kr.fees.persistence.RuleRepository;
import kr.fees.persistence.ScheduleRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * 원장 체결 조회 (기술설계서 v1.5 §6). 배정판 히트 → 우대 요율표. 미스 → 기본수수료 직접 해석(§1.4).
 * 배정판은 우대분만 담으므로 미스가 정상 경로다.
 */
@Service
public class LedgerLookupService {

    private static final AccountModel BASE_PROBE =
        new AccountModel("_BASE_", "_", "_", false, java.math.BigDecimal.ZERO, java.math.BigDecimal.ZERO);

    private final BindingRepository bindings;
    private final RuleRepository rules;
    private final ScheduleRepository schedules;
    private final RankingRepository rankings;

    public LedgerLookupService(BindingRepository bindings, RuleRepository rules, ScheduleRepository schedules,
                               RankingRepository rankings) {
        this.bindings = bindings;
        this.rules = rules;
        this.schedules = schedules;
        this.rankings = rankings;
    }

    public record LookupOutcome(String scheduleId, String sourceRuleId, RuleType sourceType, boolean fallbackToBase) {}

    public Optional<LookupOutcome> lookup(String accountId, AssetClass assetClass, LookupKey lookupKey,
                                          String exchange, String session, String product, String channel,
                                          LocalDate tradeDate) {
        var params = new BindingRepository.LookupParams(accountId, assetClass, lookupKey,
            exchange, session, product, channel, tradeDate);
        Optional<BindingRepository.LookupResult> hit = bindings.lookup(params);
        if (hit.isPresent()) {
            var r = hit.get();
            return Optional.of(new LookupOutcome(r.scheduleId(), r.sourceRuleId(), r.sourceType(), false));
        }
        // 미스 → 기본 해석
        FeeKey key = FeeKey.of(assetClass, exchange, lookupKey, session, channel, product);
        return baseWinner(key, tradeDate)
            .map(w -> new LookupOutcome(w.scheduleId(), w.ruleId(), RuleType.BASE, true));
    }

    private Optional<Winner> baseWinner(FeeKey key, LocalDate tradeDate) {
        List<RuleModel> baseRules = rules.findActive(tradeDate).stream()
            .filter(r -> r.type() == RuleType.BASE).toList();
        List<RankedPolicy> ranking = rankings.ranking(baseRules, tradeDate);
        return WinnerResolver.winnerFor(key, BASE_PROBE, List.of(), ranking, tradeDate);
    }

    public Optional<FeeScheduleModel> schedule(String scheduleId) {
        return schedules.findById(scheduleId);
    }
}
