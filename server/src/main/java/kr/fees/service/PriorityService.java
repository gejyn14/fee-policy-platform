package kr.fees.service;

import kr.fees.domain.*;
import kr.fees.persistence.RuleRepository;
import kr.fees.persistence.ScheduleRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * 정책 우선순위 조회 (PolicyPriority 화면용). 계좌 무관 통합 랭킹 — 자격 게이트는 무시한다.
 * "룰 변경 때만 재계산, 체결 때는 룩업"이라는 사전 산정 순위를 그대로 노출한다.
 */
@Service
public class PriorityService {

    private final RuleRepository rules;
    private final ScheduleRepository schedules;

    public PriorityService(RuleRepository rules, ScheduleRepository schedules) {
        this.rules = rules;
        this.schedules = schedules;
    }

    public record Entry(String ruleId, String ruleName, RuleType ruleType, String scheduleId,
                        String scheduleName, BigDecimal rank, RuleScope scope) {}

    public record TopResponse(Entry top) {}

    /** 활성 정책 통합 랭킹(요율 오름차순). assetClass null = 전체. */
    public List<Entry> ranking(AssetClass assetClass, LocalDate today) {
        List<RuleModel> active = rules.findActive(today).stream()
            .filter(r -> assetClass == null || r.scope().assetClass() == assetClass)
            .toList();
        Map<String, FeeScheduleModel> schedMap = schedules.findAllAsMap();
        return PolicyRanking.build(active, schedMap, today).stream().map(PriorityService::toEntry).toList();
    }

    /** 조회키의 이론상 최저(자격 무시) — 랭킹에서 범위가 맞는 첫 정책. 없으면 top=null. */
    public TopResponse top(AssetClass assetClass, LookupKey lookupKey,
                           String exchange, String session, String product, String channel, LocalDate today) {
        FeeKey key = FeeKey.of(assetClass, exchange, lookupKey, session, channel, product);
        List<RuleModel> active = rules.findActive(today).stream()
            .filter(r -> r.scope().assetClass() == assetClass)
            .toList();
        Map<String, FeeScheduleModel> schedMap = schedules.findAllAsMap();
        return PolicyRanking.build(active, schedMap, today).stream()
            .filter(p -> ScopeMatcher.matches(p.rule().scope(), key))
            .findFirst()
            .map(p -> new TopResponse(toEntry(p)))
            .orElse(new TopResponse(null));
    }

    private static Entry toEntry(RankedPolicy p) {
        return new Entry(p.rule().id(), p.rule().name(), p.rule().type(),
            p.schedule().id(), p.schedule().name(), p.rank(), p.rule().scope());
    }
}
