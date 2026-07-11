package kr.fees.persistence;

import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

/** 조합별 후보 색인 조회 (§10.4). 순서는 저장(rank_position), 기간 멤버십은 읽기 시점 필터. */
@Repository
public class CandidateIndexRepository {

    private final JdbcTemplate jdbc;

    public CandidateIndexRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<String> candidates(AssetClass assetClass, LookupKey lookupKey,
                                   String exchange, String product, LocalDate today) {
        return jdbc.query("""
            SELECT rule_id FROM fee_rule_candidate_index
            WHERE asset_class = ? AND lookup_key = ? AND exchange_code = ? AND product_code = ?
              AND start_date <= ?
              AND (? <= end_date OR (rule_type = 'EVENT' AND benefit_kind = 'RELATIVE'))
            ORDER BY rank_position""",
            (rs, i) -> rs.getString(1),
            assetClass.name(), lookupKey.name(),
            exchange == null ? "*" : exchange,
            product == null ? "*" : product,
            today, today);
    }

    public boolean isEmpty() {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM fee_rule_candidate_index", Integer.class);
        return n == null || n == 0;
    }
}
