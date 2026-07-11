package kr.fees.service;

import kr.fees.domain.*;
import kr.fees.persistence.CandidateIndexRepository;
import kr.fees.persistence.RankingRepository;
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
    private final RankingRepository rankings;
    private final CandidateIndexRepository candidateIndex;

    public PriorityService(RuleRepository rules, ScheduleRepository schedules, RankingRepository rankings,
                           CandidateIndexRepository candidateIndex) {
        this.rules = rules;
        this.schedules = schedules;
        this.rankings = rankings;
        this.candidateIndex = candidateIndex;
    }

    public record Entry(String ruleId, String ruleName, RuleType ruleType, String scheduleId,
                        String scheduleName, BigDecimal rank, RuleScope scope) {}

    public record TopResponse(Entry top) {}

    /** 활성 정책 통합 랭킹(요율 오름차순). assetClass null = 전체. */
    public List<Entry> ranking(AssetClass assetClass, LocalDate today) {
        List<RuleModel> active = rules.findActive(today).stream()
            .filter(r -> assetClass == null || r.scope().assetClass() == assetClass)
            .toList();
        return rankings.ranking(active, today).stream().map(PriorityService::toEntry).toList();
    }

    /** 조회키의 이론상 최저(자격 무시) — 후보 색인에서 순위순으로 고른다. 색인 미구축 시 즉석 경로 fallback. */
    public TopResponse top(AssetClass assetClass, LookupKey lookupKey,
                           String exchange, String session, String product, String channel, LocalDate today) {
        FeeKey key = FeeKey.of(assetClass, exchange, lookupKey, session, channel, product);
        if (candidateIndex.isEmpty()) {
            return topByComputation(assetClass, key, today); // 콜드스타트 fallback
        }
        Map<String, RuleModel> active = rules.findActive(today).stream()
            .collect(java.util.stream.Collectors.toMap(RuleModel::id, r -> r));
        Map<String, FeeScheduleModel> schedMap = schedules.findAllAsMap();
        Map<String, BigDecimal> ranks = rankings.storedRanks();

        // 6축 프로브('*' 포함)라 재조회 특례 불필요 — IN (?, '*') 가 구체·전체 조합을 함께 모은다.
        List<String> ids = candidateIndex.candidates(assetClass, lookupKey, exchange, product, session, channel, today);
        for (String id : ids) {
            RuleModel r = active.get(id);
            if (r == null) continue;
            if (!PolicyRanking.inRanking(r, today)) continue;
            if (!ScopeMatcher.matches(r.scope(), key)) continue; // 세션·채널 축 최종 판정
            FeeScheduleModel s = schedMap.get(r.scheduleId());
            if (s == null) continue;
            return new TopResponse(new Entry(r.id(), r.name(), r.type(), s.id(), s.name(),
                ranks.getOrDefault(id, RankKey.of(s)), r.scope()));
        }
        // 색인 경로에서 승자를 찾지 못함(파생의 품목='*' 등 색인에 없는 조합 포함) — 즉석 계산으로 fallback.
        // topByComputation 은 진짜 무해당이면 그 자체로 null 을 반환하므로 안전하다.
        return topByComputation(assetClass, key, today);
    }

    private TopResponse topByComputation(AssetClass assetClass, FeeKey key, LocalDate today) {
        List<RuleModel> active = rules.findActive(today).stream()
            .filter(r -> r.scope().assetClass() == assetClass)
            .toList();
        return rankings.ranking(active, today).stream()
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
