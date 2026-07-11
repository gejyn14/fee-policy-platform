package kr.fees.batch;

import kr.fees.domain.*;
import kr.fees.persistence.ProductRepository;
import kr.fees.persistence.RuleRepository;
import kr.fees.persistence.ScheduleRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * 순위 사전 산정 (§10.4 1단계). 승인·종료 트랜잭션에서 호출되어
 * ① 활성 룰 전건의 rank_value 를 확정 저장하고 ② 조합별 후보 색인을 전면 재생성한다.
 * 색인 전체가 MB 규모라 전면 재생성이 단순·결정적이다("걸리는 조합만 갱신"은 추후 최적화).
 * 색인에는 기간 필터를 적용하지 않는다 — 멤버십(기간)은 읽기 시점 판정, 순서만 저장.
 */
@Service
public class RankIndexService {

    private final RuleRepository rules;
    private final ScheduleRepository schedules;
    private final ProductRepository products;
    private final JdbcTemplate jdbc;

    public RankIndexService(RuleRepository rules, ScheduleRepository schedules,
                            ProductRepository products, JdbcTemplate jdbc) {
        this.rules = rules;
        this.schedules = schedules;
        this.products = products;
        this.jdbc = jdbc;
    }

    public record RebuildSummary(int rulesStamped, int combos, int indexRows) {}

    @Transactional
    public RebuildSummary rebuildAll(LocalDate today) {
        List<RuleModel> active = rules.findActive(today);
        Map<String, FeeScheduleModel> schedMap = schedules.findAllAsMap();

        // ① 순위값 확정 저장 — 산식의 단일 출처는 RankKey
        Map<String, BigDecimal> ranks = new LinkedHashMap<>();
        for (RuleModel r : active) {
            FeeScheduleModel s = schedMap.get(r.scheduleId());
            if (s == null) continue;
            BigDecimal v = RankKey.of(s);
            jdbc.update("UPDATE fee_rule SET rank_value = ? WHERE rule_id = ?", v, r.id());
            ranks.put(r.id(), v);
        }

        // ② 조합별 후보 색인 전면 재생성 (키 정렬 순 적재)
        jdbc.update("DELETE FROM fee_rule_candidate_index");
        List<RankedPolicy> allRanked = active.stream()
            .map(r -> {
                FeeScheduleModel s = schedMap.get(r.scheduleId());
                return s == null ? null : new RankedPolicy(r, s, ranks.get(r.id()));
            })
            .filter(Objects::nonNull)
            .sorted(PolicyRanking.comparator())
            .toList();

        List<ComboUniverse.Combo> combos = ComboUniverse.enumerate(products.findAll(), active);
        int rows = 0;
        for (ComboUniverse.Combo combo : combos) {
            int pos = 0;
            for (RankedPolicy p : allRanked) {
                if (!ComboUniverse.isCandidate(p.rule().scope(), combo)) continue;
                jdbc.update("""
                    INSERT INTO fee_rule_candidate_index(asset_class, lookup_key, exchange_code, product_code,
                        rank_position, rule_id, rank_value, rule_type, start_date, end_date, benefit_kind)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    combo.assetClass().name(), combo.lookupKey().name(), combo.exchange(),
                    combo.product() == null ? "*" : combo.product(),
                    ++pos, p.rule().id(), p.rank(), p.rule().type().name(),
                    p.rule().startDate(), p.rule().endDate(), p.rule().benefitKind().name());
                rows++;
            }
        }
        return new RebuildSummary(ranks.size(), combos.size(), rows);
    }
}
