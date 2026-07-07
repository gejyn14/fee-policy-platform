package kr.fees.persistence;

import kr.fees.domain.AssetClass;
import kr.fees.domain.ConditionMetric;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.Optional;

@Repository
public class QualifyPolicyRepository {

    private final JdbcTemplate jdbc;

    public QualifyPolicyRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Policy> findByAssetClass(AssetClass ac) {
        return jdbc.query("SELECT * FROM qualify_policy WHERE asset_class = ?",
            (rs, n) -> new Policy(AssetClass.valueOf(rs.getString("asset_class")),
                ConditionMetric.valueOf(rs.getString("metric")), rs.getBigDecimal("threshold")),
            ac.name()).stream().findFirst();
    }

    public record Policy(AssetClass assetClass, ConditionMetric metric, BigDecimal threshold) {}
}
