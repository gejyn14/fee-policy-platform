package kr.fees.batch;

import kr.fees.domain.*;
import kr.fees.persistence.ProductRepository;
import kr.fees.persistence.RuleRepository;
import kr.fees.persistence.ScheduleRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger LOG = LoggerFactory.getLogger(RankIndexService.class);

    private static final String INSERT_SQL = """
        INSERT INTO fee_rule_candidate_index(asset_class, lookup_key, exchange_code, product_code,
            rank_position, rule_id, rank_value, rule_type, start_date, end_date, benefit_kind)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""";

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

        // ① 순위값 확정 저장 — 산식의 단일 출처는 RankKey. 스케줄 조회는 룰당 1회만 수행하고
        //    바로 RankedPolicy 재료(값)까지 함께 만든다 (정렬은 아래서 한 번만).
        List<Object[]> rankArgs = new ArrayList<>();
        List<RankedPolicy> preRanked = new ArrayList<>();
        for (RuleModel r : active) {
            FeeScheduleModel s = schedMap.get(r.scheduleId());
            if (s == null) {
                // FK 불변식상 도달 불가능한 경로 — PolicyRanking.fromStored 의 누락 처리와 대칭으로 WARN만 남기고 계속한다.
                LOG.warn("스케줄 누락 — rank_value 스탬프 건너뜀: rule={}, scheduleId={}", r.id(), r.scheduleId());
                continue;
            }
            BigDecimal v = RankKey.of(s);
            rankArgs.add(new Object[]{v, r.id()});
            preRanked.add(new RankedPolicy(r, s, v));
        }
        if (!rankArgs.isEmpty()) {
            jdbc.batchUpdate("UPDATE fee_rule SET rank_value = ? WHERE rule_id = ?", rankArgs);
        }

        // ② 조합별 후보 색인 전면 재생성 (키 정렬은 여기서 한 번만, 조합마다 순위 재부여)
        jdbc.update("DELETE FROM fee_rule_candidate_index");
        List<RankedPolicy> allRanked = preRanked.stream()
            .sorted(PolicyRanking.comparator())
            .toList();

        List<ComboUniverse.Combo> combos = ComboUniverse.enumerate(products.findAll(), active);
        List<Object[]> insertArgs = new ArrayList<>();
        for (ComboUniverse.Combo combo : combos) {
            int pos = 0;
            for (RankedPolicy p : allRanked) {
                if (!ComboUniverse.isCandidate(p.rule().scope(), combo)) continue;
                insertArgs.add(new Object[]{
                    combo.assetClass().name(), combo.lookupKey().name(), combo.exchange(),
                    combo.product() == null ? "*" : combo.product(),
                    ++pos, p.rule().id(), p.rank(), p.rule().type().name(),
                    p.rule().startDate(), p.rule().endDate(), p.rule().benefitKind().name()
                });
            }
        }
        if (!insertArgs.isEmpty()) {
            jdbc.batchUpdate(INSERT_SQL, insertArgs);
        }
        return new RebuildSummary(rankArgs.size(), combos.size(), insertArgs.size());
    }
}
