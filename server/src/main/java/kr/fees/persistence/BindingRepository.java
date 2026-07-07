package kr.fees.persistence;

import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import kr.fees.domain.RuleType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public class BindingRepository {

    private final JdbcTemplate jdbc;

    public BindingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<BindingRow> findByAccount(String accountId) {
        return jdbc.query("SELECT * FROM fee_binding WHERE account_id = ? ORDER BY asset_class, lookup_key, product_code",
            this::map, accountId);
    }

    public long countAll() {
        Long n = jdbc.queryForObject("SELECT count(*) FROM fee_binding", Long.class);
        return n == null ? 0 : n;
    }

    /** 원장 체결 조회 계약(§4). 구체 행(품목·채널·세션·거래소 한정) 우선, 없으면 empty → 호출측이 기본수수료 적용. */
    public Optional<LookupResult> lookup(LookupParams p) {
        List<LookupResult> rows = jdbc.query("""
            SELECT schedule_id, source_rule_id, source_type FROM fee_binding
            WHERE account_id = ? AND asset_class = ? AND lookup_key = ?
              AND exchange_code IN (?, '*') AND session_code IN (?, '*')
              AND product_code IN (?, '*') AND channel_code IN (?, '*')
              AND valid_from <= ? AND ? <= valid_to
            ORDER BY (product_code = ?) DESC, (channel_code = ?) DESC,
                     (session_code = ?) DESC, (exchange_code = ?) DESC
            LIMIT 1""",
            (rs, n) -> new LookupResult(rs.getString("schedule_id"), rs.getString("source_rule_id"),
                RuleType.valueOf(rs.getString("source_type"))),
            p.accountId(), p.assetClass().name(), p.lookupKey().name(),
            p.exchange(), p.session(), p.product(), p.channel(),
            p.tradeDate(), p.tradeDate(),
            p.product(), p.channel(), p.session(), p.exchange());
        return rows.stream().findFirst();
    }

    /** 키 정렬 순서로 append 적재(§10.3). */
    public void batchInsert(List<BindingRow> rows) {
        jdbc.batchUpdate("""
            INSERT INTO fee_binding(account_id, asset_class, exchange_code, lookup_key, session_code,
                product_code, channel_code, valid_from, valid_to, schedule_id, source_rule_id, source_type, reason)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows, rows.size(), (ps, r) -> {
                int i = 1;
                ps.setString(i++, r.accountId());
                ps.setString(i++, r.assetClass().name());
                ps.setString(i++, r.exchangeCode());
                ps.setString(i++, r.lookupKey().name());
                ps.setString(i++, r.sessionCode());
                ps.setString(i++, r.productCode());
                ps.setString(i++, r.channelCode());
                ps.setObject(i++, r.validFrom());
                ps.setObject(i++, r.validTo());
                ps.setString(i++, r.scheduleId());
                ps.setString(i++, r.sourceRuleId());
                ps.setString(i++, r.sourceType().name());
                ps.setString(i, r.reason());
            });
    }

    public void deleteByAccount(String accountId) {
        jdbc.update("DELETE FROM fee_binding WHERE account_id = ?", accountId);
    }

    public void deleteByKey(BindingRow r) {
        jdbc.update("""
            DELETE FROM fee_binding WHERE account_id=? AND asset_class=? AND exchange_code=? AND lookup_key=?
              AND session_code=? AND product_code=? AND channel_code=? AND valid_from=?""",
            r.accountId(), r.assetClass().name(), r.exchangeCode(), r.lookupKey().name(),
            r.sessionCode(), r.productCode(), r.channelCode(), r.validFrom());
    }

    private BindingRow map(ResultSet rs, int rowNum) throws SQLException {
        return new BindingRow(
            rs.getString("account_id"), AssetClass.valueOf(rs.getString("asset_class")),
            rs.getString("exchange_code"), LookupKey.valueOf(rs.getString("lookup_key")),
            rs.getString("session_code"), rs.getString("product_code"), rs.getString("channel_code"),
            rs.getObject("valid_from", LocalDate.class), rs.getObject("valid_to", LocalDate.class),
            rs.getString("schedule_id"), rs.getString("source_rule_id"),
            RuleType.valueOf(rs.getString("source_type")), rs.getString("reason"));
    }

    public record LookupResult(String scheduleId, String sourceRuleId, RuleType sourceType) {}

    public record LookupParams(String accountId, AssetClass assetClass, LookupKey lookupKey,
                               String exchange, String session, String product, String channel, LocalDate tradeDate) {}
}
