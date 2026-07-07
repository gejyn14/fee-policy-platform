package kr.fees.persistence;

import kr.fees.domain.AccountModel;
import kr.fees.domain.AssetClass;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Repository
public class AccountRepository {

    private final JdbcTemplate jdbc;

    public AccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<AccountModel> findAll() {
        return jdbc.query("SELECT * FROM account ORDER BY account_id", this::map);
    }

    public Optional<AccountModel> findById(String id) {
        return jdbc.query("SELECT * FROM account WHERE account_id = ?", this::map, id).stream().findFirst();
    }

    /** 계좌가 개설한 상품군 — 셀 유니버스 pruning 기준. */
    public Set<AssetClass> openedGroups(String accountId) {
        return jdbc.queryForList("SELECT asset_class FROM account_product_group WHERE account_id = ?",
                String.class, accountId)
            .stream().map(AssetClass::valueOf).collect(Collectors.toCollection(java.util.LinkedHashSet::new));
    }

    /** 특정 상품군을 개설한 계좌들 — 신규 룰 delta 영향 범위. */
    public List<String> accountIdsByOpenedGroup(AssetClass ac) {
        return jdbc.queryForList("SELECT account_id FROM account_product_group WHERE asset_class = ?",
            String.class, ac.name());
    }

    private AccountModel map(ResultSet rs, int rowNum) throws SQLException {
        return new AccountModel(
            rs.getString("account_id"), rs.getString("account_name"), rs.getString("grade"),
            rs.getBoolean("dormant_returned"), rs.getBigDecimal("metric_6m_asset"), rs.getBigDecimal("metric_6m_volume"));
    }
}
