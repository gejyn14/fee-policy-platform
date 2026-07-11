package kr.fees.persistence;

import kr.fees.domain.FeeScheduleModel;
import kr.fees.domain.PolicyRanking;
import kr.fees.domain.RankedPolicy;
import kr.fees.domain.RuleModel;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 저장 순위 읽기 경로 (§10.4). 순위 계산은 승인 시점(RankIndexService) 한 곳 —
 * 배치·증분·화면·추적·미스경로는 여기서 저장 순위를 읽기만 한다.
 */
@Repository
public class RankingRepository {

    private final ScheduleRepository schedules;
    private final JdbcTemplate jdbc;

    public RankingRepository(ScheduleRepository schedules, JdbcTemplate jdbc) {
        this.schedules = schedules;
        this.jdbc = jdbc;
    }

    public Map<String, BigDecimal> storedRanks() {
        Map<String, BigDecimal> m = new LinkedHashMap<>();
        jdbc.query("SELECT rule_id, rank_value FROM fee_rule WHERE rank_value IS NOT NULL",
            rs -> { m.put(rs.getString(1), rs.getBigDecimal(2)); });
        return m;
    }

    /** 기존 PolicyRanking.build(active, schedMap, today) 호출을 이 한 줄로 대체한다. */
    public List<RankedPolicy> ranking(List<RuleModel> active, LocalDate today) {
        Map<String, FeeScheduleModel> schedMap = schedules.findAllAsMap();
        return PolicyRanking.fromStored(active, schedMap, storedRanks(), today);
    }
}
