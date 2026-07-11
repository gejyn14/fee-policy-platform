package kr.fees.persistence;

import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** 조합별 후보 색인 조회 (§10.4). 순서는 저장(rank_position), 기간 멤버십은 읽기 시점 필터. */
@Repository
public class CandidateIndexRepository {

    private final JdbcTemplate jdbc;

    public CandidateIndexRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 점 조회(top)용: 구체 조회키가 걸릴 수 있는 조합('*' 포함)을 전부 모아,
     * 저장된 4키 정렬(rank_value, tie_order, specificity DESC, rule_id)로 돌려준다.
     * 조합 횡단이라 rank_position 은 쓰지 않는다. 같은 룰이 여러 조합에 실릴 수 있어 중복 제거.
     * 기간 멤버십은 읽기 시점 필터(PolicyRanking.inRanking 과 동일 의미론).
     */
    public List<String> candidates(AssetClass assetClass, LookupKey lookupKey, String exchange,
                                   String product, String session, String channel, LocalDate today) {
        List<String> ids = jdbc.query("""
            SELECT rule_id FROM fee_rule_candidate_index
            WHERE asset_class = ? AND lookup_key = ?
              AND exchange_code IN (?, '*') AND product_code IN (?, '*')
              AND session_code IN (?, '*') AND channel_code IN (?, '*')
              AND (
                (rule_type = 'EVENT' AND benefit_kind = 'RELATIVE')
                OR (start_date <= ? AND ? <= end_date)
              )
            ORDER BY rank_value, tie_order, specificity DESC, rule_id""",
            (rs, i) -> rs.getString(1),
            assetClass.name(), lookupKey.name(),
            exchange == null ? "*" : exchange,
            product == null ? "*" : product,
            session == null ? "*" : session,
            channel == null ? "*" : channel,
            today, today);
        return new ArrayList<>(new LinkedHashSet<>(ids));
    }

    public boolean isEmpty() {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM fee_rule_candidate_index", Integer.class);
        return n == null || n == 0;
    }
}
